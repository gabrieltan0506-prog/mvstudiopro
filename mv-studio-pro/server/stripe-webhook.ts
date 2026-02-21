import type { Request, Response, Express } from "express";
import { getStripe } from "./stripe";
import { addCredits, updateSubscription } from "./credits";
import { CREDIT_PACKS } from "./plans";
import { getDb } from "./db";
import { stripeCustomers, stripeInvoices, creditBalances } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import express from "express";
import { writeAuditLog } from "./audit";
import { webhookLimit } from "./rate-limit";

/**
 * Stripe Webhook 路由（增强版）
 *
 * 添加功能：
 * - charge.refunded：退款处理（扣回 Credits）
 * - customer.subscription.trial_will_end：试用到期提醒
 * - invoice.created / invoice.finalized：发票记录同步
 * - 所有事件写入审计日志
 * - Rate Limiting 保护
 */
export function registerStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    webhookLimit,
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const stripe = getStripe();
      if (!stripe) {
        console.warn("[Stripe Webhook] Stripe not configured");
        res.status(400).json({ error: "Stripe not configured" });
        return;
      }

      const sig = req.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.warn("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set");
        res.status(400).json({ error: "Webhook secret not configured" });
        return;
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
        await writeAuditLog({
          eventType: "webhook.signature_failed",
          action: "verify",
          status: "failed",
          errorMessage: err.message,
          ipAddress: req.ip || req.socket.remoteAddress || null,
        });
        res.status(400).json({ error: `Webhook Error: ${err.message}` });
        return;
      }

      console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

      try {
        switch (event.type) {
          case "checkout.session.completed":
            await handleCheckoutCompleted(event);
            break;

          case "customer.subscription.created":
          case "customer.subscription.updated":
            await handleSubscriptionUpdate(event);
            break;

          case "customer.subscription.deleted":
            await handleSubscriptionDeleted(event);
            break;

          case "customer.subscription.trial_will_end":
            await handleTrialWillEnd(event);
            break;

          case "invoice.paid":
            await handleInvoicePaid(event);
            break;

          case "invoice.payment_failed":
            await handleInvoicePaymentFailed(event);
            break;

          case "invoice.created":
          case "invoice.finalized":
            await handleInvoiceSync(event);
            break;

          case "charge.refunded":
            await handleChargeRefunded(event);
            break;

          default:
            console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
            await writeAuditLog({
              eventType: event.type,
              eventId: event.id,
              action: "unhandled",
              status: "success",
              metadata: { livemode: event.livemode },
            });
        }

        res.json({ received: true });
      } catch (err: any) {
        console.error(`[Stripe Webhook] Error handling event: ${err.message}`);
        await writeAuditLog({
          eventType: event.type,
          eventId: event.id,
          action: "handle_error",
          status: "failed",
          errorMessage: err.message,
        });
        res.status(500).json({ error: "Webhook handler failed" });
      }
    }
  );
}

// ─── Helper：根据 stripeCustomerId 查找 userId ──────
async function findUserByStripeCustomer(stripeCustomerId: string): Promise<{ userId: number; plan: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const customer = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, stripeCustomerId))
    .limit(1);

  return customer.length > 0 ? { userId: customer[0].userId, plan: customer[0].plan ?? "free" } : null;
}

// ─── Checkout 完成 ─────────────────────────────────
async function handleCheckoutCompleted(event: any) {
  const session = event.data.object;
  const userId = parseInt(session.metadata?.userId ?? "0");
  const type = session.metadata?.type;
  const stripeCustomerId = session.customer as string;

  if (!userId) {
    console.warn("[Stripe Webhook] No userId in checkout session metadata");
    return;
  }

  if (type === "credit_pack") {
    const packId = session.metadata?.packId as keyof typeof CREDIT_PACKS;
    const pack = CREDIT_PACKS[packId];
    if (pack) {
      await addCredits(userId, pack.credits, "purchase", session.payment_intent as string);
      console.log(`[Stripe Webhook] Added ${pack.credits} credits to user ${userId}`);
    }
  }

  await writeAuditLog({
    userId,
    eventType: "checkout.session.completed",
    eventId: event.id,
    stripeCustomerId,
    action: type === "credit_pack" ? "purchase_credits" : "subscribe",
    amount: session.amount_total,
    currency: session.currency,
    metadata: { type, packId: session.metadata?.packId, planId: session.metadata?.planId },
  });
}

// ─── 订阅更新 ──────────────────────────────────────
async function handleSubscriptionUpdate(event: any) {
  const subscription = event.data.object;
  const stripeCustomerId = subscription.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  if (!customerInfo) {
    console.warn(`[Stripe Webhook] No customer found for ${stripeCustomerId}`);
    return;
  }

  const db = await getDb();
  if (!db) return;

  const userId = customerInfo.userId;
  const priceId = subscription.items?.data?.[0]?.price?.id;

  let plan: "free" | "pro" | "enterprise" = "free";
  if (priceId === process.env.STRIPE_PRO_MONTHLY_PRICE_ID || priceId === process.env.STRIPE_PRO_YEARLY_PRICE_ID) {
    plan = "pro";
  } else if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) {
    plan = "enterprise";
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : undefined;

  // 检测是否从 trial 转为 active（trial_to_paid 转化）
  const previousAttributes = event.data.previous_attributes;
  const isTrialToPaid =
    previousAttributes?.status === "trialing" && subscription.status === "active";

  await updateSubscription(userId, plan, stripeCustomerId, subscription.id, currentPeriodEnd);

  await db
    .update(stripeCustomers)
    .set({
      cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
      // 记录试用状态
      ...(subscription.status === "trialing" ? { trialEnd: new Date(subscription.trial_end * 1000) } : {}),
    })
    .where(eq(stripeCustomers.userId, userId));

  await writeAuditLog({
    userId,
    eventType: event.type,
    eventId: event.id,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    action: isTrialToPaid ? "trial_to_paid" : "subscription_update",
    metadata: {
      plan,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      isTrialToPaid,
      priceId,
    },
  });

  console.log(`[Stripe Webhook] Updated subscription for user ${userId}: ${plan} (status: ${subscription.status})`);
}

// ─── 订阅取消 ──────────────────────────────────────
async function handleSubscriptionDeleted(event: any) {
  const subscription = event.data.object;
  const stripeCustomerId = subscription.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  if (!customerInfo) return;

  const db = await getDb();
  if (!db) return;

  const userId = customerInfo.userId;
  const previousPlan = customerInfo.plan;

  await db
    .update(stripeCustomers)
    .set({
      plan: "free",
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: 0,
    })
    .where(eq(stripeCustomers.userId, userId));

  await writeAuditLog({
    userId,
    eventType: "customer.subscription.deleted",
    eventId: event.id,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    action: "subscription_cancelled",
    metadata: { previousPlan, reason: subscription.cancellation_details?.reason },
  });

  console.log(`[Stripe Webhook] Subscription deleted for user ${userId}, downgraded to free`);
}

// ─── 试用即将到期提醒（3天前） ────────────────────
async function handleTrialWillEnd(event: any) {
  const subscription = event.data.object;
  const stripeCustomerId = subscription.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  if (!customerInfo) return;

  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : null;

  await writeAuditLog({
    userId: customerInfo.userId,
    eventType: "customer.subscription.trial_will_end",
    eventId: event.id,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    action: "trial_ending_soon",
    metadata: {
      trialEnd: trialEnd?.toISOString(),
      daysRemaining: trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / 86400000) : null,
    },
  });

  // TODO: 发送 Email/推送通知提醒用户试用即将到期
  console.log(
    `[Stripe Webhook] Trial ending soon for user ${customerInfo.userId}, ends at ${trialEnd?.toISOString()}`
  );
}

// ─── 发票付款成功 ──────────────────────────────────
async function handleInvoicePaid(event: any) {
  const invoice = event.data.object;
  const stripeCustomerId = invoice.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  // 同步发票记录
  await syncInvoiceRecord(invoice, customerInfo?.userId);

  if (invoice.billing_reason === "subscription_cycle" && customerInfo) {
    const { PLANS } = await import("./plans");
    const planConfig = PLANS[customerInfo.plan as keyof typeof PLANS];
    if (planConfig && planConfig.monthlyCredits > 0) {
      await addCredits(customerInfo.userId, planConfig.monthlyCredits, "subscription");
      console.log(`[Stripe Webhook] Renewed ${planConfig.monthlyCredits} credits for user ${customerInfo.userId}`);
    }
  }

  await writeAuditLog({
    userId: customerInfo?.userId ?? null,
    eventType: "invoice.paid",
    eventId: event.id,
    stripeCustomerId,
    action: "invoice_paid",
    amount: invoice.amount_paid,
    currency: invoice.currency,
    metadata: {
      invoiceId: invoice.id,
      billingReason: invoice.billing_reason,
      subscriptionId: invoice.subscription,
    },
  });
}

// ─── 发票付款失败 ──────────────────────────────────
async function handleInvoicePaymentFailed(event: any) {
  const invoice = event.data.object;
  const stripeCustomerId = invoice.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  // 同步发票记录
  await syncInvoiceRecord(invoice, customerInfo?.userId);

  await writeAuditLog({
    userId: customerInfo?.userId ?? null,
    eventType: "invoice.payment_failed",
    eventId: event.id,
    stripeCustomerId,
    action: "payment_failed",
    status: "failed",
    amount: invoice.amount_due,
    currency: invoice.currency,
    metadata: {
      invoiceId: invoice.id,
      attemptCount: invoice.attempt_count,
      nextPaymentAttempt: invoice.next_payment_attempt,
      billingReason: invoice.billing_reason,
    },
  });

  // TODO: 发送付款失败通知（Email/推送）
  console.warn(
    `[Stripe Webhook] Invoice payment failed for user ${customerInfo?.userId ?? "unknown"} (attempt ${invoice.attempt_count})`
  );
}

// ─── 发票同步（created / finalized） ──────────────
async function handleInvoiceSync(event: any) {
  const invoice = event.data.object;
  const stripeCustomerId = invoice.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  await syncInvoiceRecord(invoice, customerInfo?.userId);

  await writeAuditLog({
    userId: customerInfo?.userId ?? null,
    eventType: event.type,
    eventId: event.id,
    stripeCustomerId,
    action: "invoice_sync",
    amount: invoice.amount_due,
    currency: invoice.currency,
    metadata: { invoiceId: invoice.id, status: invoice.status },
  });
}

// ─── 退款处理 ──────────────────────────────────────
async function handleChargeRefunded(event: any) {
  const charge = event.data.object;
  const stripeCustomerId = charge.customer as string;
  const customerInfo = await findUserByStripeCustomer(stripeCustomerId);

  if (!customerInfo) {
    console.warn(`[Stripe Webhook] Refund: No customer found for ${stripeCustomerId}`);
    await writeAuditLog({
      eventType: "charge.refunded",
      eventId: event.id,
      stripeCustomerId,
      action: "refund_no_customer",
      status: "failed",
      amount: -(charge.amount_refunded ?? 0),
      currency: charge.currency,
    });
    return;
  }

  const db = await getDb();
  if (!db) return;

  const userId = customerInfo.userId;
  const refundedAmount = charge.amount_refunded ?? 0; // 分为单位

  // 计算需要扣回的 Credits（按比例）
  // 假设 $1 = 约 5.8 Credits（基于 $9.99 = 100 Credits 的小包比例）
  const creditsToDeduct = Math.ceil((refundedAmount / 100) * 5.8);

  if (creditsToDeduct > 0) {
    // 从用户余额中扣回 Credits
    const balance = await db
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.userId, userId))
      .limit(1);

    if (balance.length > 0) {
      const newBalance = Math.max(0, balance[0].balance - creditsToDeduct);
      await db
        .update(creditBalances)
        .set({ balance: newBalance, lifetimeSpent: balance[0].lifetimeSpent + creditsToDeduct })
        .where(eq(creditBalances.userId, userId));

      console.log(
        `[Stripe Webhook] Refund: Deducted ${creditsToDeduct} credits from user ${userId} (refund: $${(refundedAmount / 100).toFixed(2)})`
      );
    }
  }

  await writeAuditLog({
    userId,
    eventType: "charge.refunded",
    eventId: event.id,
    stripeCustomerId,
    action: "refund_processed",
    amount: -refundedAmount,
    currency: charge.currency,
    metadata: {
      chargeId: charge.id,
      refundedAmount,
      creditsDeducted: creditsToDeduct,
      refundReason: charge.refunds?.data?.[0]?.reason,
    },
  });
}

// ─── 同步发票记录到本地数据库 ─────────────────────
async function syncInvoiceRecord(invoice: any, userId?: number | null) {
  const db = await getDb();
  if (!db || !userId) return;

  try {
    const existing = await db
      .select()
      .from(stripeInvoices)
      .where(eq(stripeInvoices.stripeInvoiceId, invoice.id))
      .limit(1);

    const invoiceData = {
      userId,
      stripeInvoiceId: invoice.id,
      stripeCustomerId: invoice.customer as string,
      status: invoice.status ?? "unknown",
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? "usd",
      invoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
      billingReason: invoice.billing_reason ?? null,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
      paidAt: invoice.status === "paid" && invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : null,
    };

    if (existing.length > 0) {
      await db
        .update(stripeInvoices)
        .set(invoiceData)
        .where(eq(stripeInvoices.stripeInvoiceId, invoice.id));
    } else {
      await db.insert(stripeInvoices).values(invoiceData);
    }
  } catch (err) {
    console.error("[Stripe Webhook] Failed to sync invoice record:", err);
  }
}
