import { Router, raw } from "express";
import Stripe from "stripe";
import { getStripe } from "./stripe-products";
import { getDb } from "./db";
import { stripeCustomers, creditBalances, creditTransactions, stripeAuditLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const webhookRouter = Router();

// MUST use raw body for signature verification
webhookRouter.post("/api/stripe/webhook", raw({ type: "application/json" }), async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("[Stripe Webhook] Missing signature or webhook secret");
    return res.status(400).json({ error: "Missing signature or webhook secret" });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCanceled(subscription);
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    // Log audit
    const db = await getDb();
    if (db) {
      await db.insert(stripeAuditLogs).values({
        eventType: event.type,
        eventId: event.id,
        action: "webhook_processed",
        status: "success",
        metadata: JSON.stringify({ eventType: event.type }),
      });
    }
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
    const db = await getDb();
    if (db) {
      await db.insert(stripeAuditLogs).values({
        eventType: event.type,
        eventId: event.id,
        action: "webhook_error",
        status: "error",
        errorMessage: err.message,
      });
    }
  }

  res.json({ received: true });
});

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const db = await getDb();
  if (!db) return;

  const userId = session.metadata?.user_id ? parseInt(session.metadata.user_id) : null;
  if (!userId) {
    console.error("[Stripe] No user_id in session metadata");
    return;
  }

  const customerId = session.customer as string;

  // Check if it's a credit pack purchase (one-time payment)
  if (session.mode === "payment") {
    const creditsPurchased = session.metadata?.credits ? parseInt(session.metadata.credits) : 0;
    if (creditsPurchased > 0) {
      // Add credits to user balance
      const existing = await db.select().from(creditBalances).where(eq(creditBalances.userId, userId)).limit(1);
      if (existing.length > 0) {
        const newBalance = existing[0].balance + creditsPurchased;
        await db.update(creditBalances).set({
          balance: newBalance,
          lifetimeEarned: existing[0].lifetimeEarned + creditsPurchased,
        }).where(eq(creditBalances.userId, userId));

        await db.insert(creditTransactions).values({
          userId,
          amount: creditsPurchased,
          type: "purchase",
          source: "stripe",
          action: "credit_pack",
          description: `购买 ${creditsPurchased} Credits`,
          balanceAfter: newBalance,
        });
      } else {
        await db.insert(creditBalances).values({
          userId,
          balance: creditsPurchased,
          lifetimeEarned: creditsPurchased,
          lifetimeSpent: 0,
        });
        await db.insert(creditTransactions).values({
          userId,
          amount: creditsPurchased,
          type: "purchase",
          source: "stripe",
          action: "credit_pack",
          description: `购买 ${creditsPurchased} Credits`,
          balanceAfter: creditsPurchased,
        });
      }
      console.log(`[Stripe] Added ${creditsPurchased} credits to user ${userId}`);
    }
  }

  // Upsert stripe customer record
  if (customerId) {
    const existingCustomer = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, userId)).limit(1);
    if (existingCustomer.length === 0) {
      await db.insert(stripeCustomers).values({
        userId,
        stripeCustomerId: customerId,
        plan: "free",
      });
    }
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) return;

  const customerId = subscription.customer as string;
  const customer = await db.select().from(stripeCustomers).where(eq(stripeCustomers.stripeCustomerId, customerId)).limit(1);
  if (customer.length === 0) return;

  const planType = subscription.metadata?.plan_type || "pro";

  await db.update(stripeCustomers).set({
    plan: planType,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
  }).where(eq(stripeCustomers.stripeCustomerId, customerId));

  // Grant monthly credits on subscription creation/renewal
  if (subscription.status === "active") {
    const monthlyCredits = planType === "enterprise" ? 2000 : 500;
    const userId = customer[0].userId;
    const existing = await db.select().from(creditBalances).where(eq(creditBalances.userId, userId)).limit(1);
    if (existing.length > 0) {
      const newBalance = existing[0].balance + monthlyCredits;
      await db.update(creditBalances).set({
        balance: newBalance,
        lifetimeEarned: existing[0].lifetimeEarned + monthlyCredits,
      }).where(eq(creditBalances.userId, userId));
      await db.insert(creditTransactions).values({
        userId,
        amount: monthlyCredits,
        type: "subscription",
        source: "stripe",
        action: "monthly_credits",
        description: `${planType === "enterprise" ? "企业版" : "专业版"}月度 Credits 发放`,
        balanceAfter: newBalance,
      });
    } else {
      await db.insert(creditBalances).values({
        userId,
        balance: monthlyCredits,
        lifetimeEarned: monthlyCredits,
        lifetimeSpent: 0,
      });
    }
  }

  console.log(`[Stripe] Subscription updated for customer ${customerId}: ${planType}`);
}

async function handleSubscriptionCanceled(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) return;

  const customerId = subscription.customer as string;
  await db.update(stripeCustomers).set({
    plan: "free",
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: 0,
  }).where(eq(stripeCustomers.stripeCustomerId, customerId));

  console.log(`[Stripe] Subscription canceled for customer ${customerId}`);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  console.log(`[Stripe] Invoice paid: ${invoice.id}, amount: ${invoice.amount_paid}`);
}

export { webhookRouter };
