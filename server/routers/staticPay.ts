/**
 * 静态收款码支付路由
 *
 * 流程：
 * 1. 用户选套餐 → getPaymentInfo 获取收款码图片路径 + 应付金额
 * 2. 用户扫码付款（微信/支付宝固定收款码）
 * 3. 用户点「我已付款」→ submitConfirmation：服务端按套餐表校验金额与 Credits，**立即到账**并记为 approved
 * 4. （可选）管理员仍可走 approvePayment 处理历史 pending 单，或 rejectPayment
 *
 * 说明：无第三方支付回调时，到账依赖用户诚信 + 服务端防篡改（禁止客户端自拟积分/价格）。
 * 订单 client orderId 用于幂等，避免重复点击重复入账。
 */
import { z } from "zod";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { addCredits } from "../credits";
import { hasUnlimitedAccess } from "../services/access-policy";
import { users } from "../../drizzle/schema";
import { paymentSubmissions } from "../../drizzle/schema-payments";
import { nanoid } from "nanoid";
import { CREDIT_PACKS } from "../plans";
import { TRIAL_PACK_199_MAX_PURCHASES_PER_USER } from "../../shared/plans";

/** 公司全称（付款后在微信/支付宝收款界面显示） */
export const COMPANY_NAME = "上海德智熙人工智能科技有限公司";

/** 静态收款码图片路径（用户需将图片放至 client/public/assets/payment/ 目录） */
const QR_IMAGE_PATHS = {
  wechat: "/assets/payment/wechat-collect.jpg",
  alipay: "/assets/payment/alipay-collect.jpg",
} as const;

type BillingCycle = "monthly" | "quarterly" | "yearly";
type PackId = keyof typeof CREDIT_PACKS;

/** 试用包订单数（pending 占用名额，避免重复提交；approved 为已通过次数） */
async function countTrial199SubmissionsForUser(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  statuses: ("pending" | "approved")[],
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(paymentSubmissions)
    .where(
      and(
        eq(paymentSubmissions.userId, userId),
        like(paymentSubmissions.packageType, "trial199_%"),
        inArray(paymentSubmissions.status, statuses),
      ),
    );
  return Number(row?.n ?? 0);
}

function assertTrial199PurchaseAllowed(
  pendingOrApproved: number,
) {
  if (pendingOrApproved >= TRIAL_PACK_199_MAX_PURCHASES_PER_USER) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `¥19.9 试用包每人最多购买 ${TRIAL_PACK_199_MAX_PURCHASES_PER_USER} 次，您已达上限`,
    });
  }
}

function calcPriceAndCredits(
  packId: PackId,
  cycle: BillingCycle
): { price: number; credits: number; discountLabel: string } {
  const pack = CREDIT_PACKS[packId];
  if (packId === "trial199") {
    return { price: pack.price, credits: pack.credits, discountLabel: "试用包单次 · 不参与季/年折" };
  }
  if (cycle === "quarterly") {
    return {
      price: Math.round(pack.price * 3 * 0.9),
      credits: pack.credits * 3,
      discountLabel: "季度套餐九折",
    };
  }
  if (cycle === "yearly") {
    return {
      price: Math.round(pack.price * 12 * 0.8),
      credits: pack.credits * 12,
      discountLabel: "年度套餐八折",
    };
  }
  return { price: pack.price, credits: pack.credits, discountLabel: "" };
}

function screenshotUrlForAutoOrder(orderId: string, note?: string): string {
  const tail = (note ?? "").trim();
  return tail ? `staticPay:auto|${orderId}\n${tail}` : `staticPay:auto|${orderId}`;
}

export const staticPayRouter = router({
  // ─── 获取支付信息（QR 图片 + 应付金额）───────────────
  getPaymentInfo: protectedProcedure
    .input(
      z.object({
        packId: z.enum(["trial199", "small", "medium", "large", "mega"]),
        method: z.enum(["wechat", "alipay"]),
        billingCycle: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.packId === "trial199") {
        const db = await getDb();
        if (db) {
          const used = await countTrial199SubmissionsForUser(db, ctx.user.id, ["pending", "approved"]);
          assertTrial199PurchaseAllowed(used);
        }
      }
      const { price, credits, discountLabel } = calcPriceAndCredits(
        input.packId,
        input.billingCycle
      );
      const pack = CREDIT_PACKS[input.packId];
      return {
        qrImageUrl: QR_IMAGE_PATHS[input.method],
        companyName: COMPANY_NAME,
        amount: price,
        credits,
        packLabel: pack.labelCn,
        discountLabel,
        method: input.method,
        orderId: `PAY-${Date.now()}-${nanoid(6).toUpperCase()}`,
      };
    }),

  // ─── 用户提交"我已付款"确认 ────────────────────────
  submitConfirmation: protectedProcedure
    .input(
      z.object({
        orderId: z.string().min(1).max(50),
        packId: z.enum(["trial199", "small", "medium", "large", "mega"]),
        method: z.enum(["wechat", "alipay"]),
        amount: z.number().positive(),
        credits: z.number().int().positive(),
        billingCycle: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
        transactionNote: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const expected = calcPriceAndCredits(input.packId, input.billingCycle);
      if (input.credits !== expected.credits) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "到账积分与当前套餐不一致，请刷新定价页后重试",
        });
      }
      if (!Number.isFinite(input.amount) || Math.abs(Number(input.amount) - expected.price) > 0.001) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "支付金额与当前套餐不一致，请刷新定价页后重试",
        });
      }

      if (input.packId === "trial199") {
        const used = await countTrial199SubmissionsForUser(db, ctx.user.id, ["pending", "approved"]);
        assertTrial199PurchaseAllowed(used);
      }

      const screenshotUrl = screenshotUrlForAutoOrder(input.orderId, input.transactionNote);
      const orderPrefix = `staticPay:auto|${input.orderId}%`;
      const [duplicate] = await db
        .select({ id: paymentSubmissions.id, status: paymentSubmissions.status })
        .from(paymentSubmissions)
        .where(
          and(eq(paymentSubmissions.userId, ctx.user.id), like(paymentSubmissions.screenshotUrl, orderPrefix)),
        )
        .limit(1);

      if (duplicate?.status === "approved") {
        return {
          success: true,
          orderId: input.orderId,
          creditsAdded: 0,
          duplicate: true as const,
          message: `${COMPANY_NAME}：该付款确认已处理过，积分早前已入账`,
        };
      }
      if (duplicate?.status === "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该订单正在处理中，请稍候或联系客服",
        });
      }

      await addCredits(ctx.user.id, expected.credits, "payment", input.orderId);

      await db.insert(paymentSubmissions).values({
        userId: ctx.user.id,
        packageType: `${input.packId}_${input.billingCycle}`,
        amount: String(expected.price),
        paymentMethod: input.method,
        screenshotUrl,
        status: "approved",
        reviewedBy: null,
        reviewedAt: new Date(),
      });

      return {
        success: true,
        orderId: input.orderId,
        creditsAdded: expected.credits,
        duplicate: false as const,
        message: `${COMPANY_NAME} 充值成功，已到账 ${expected.credits} 积分`,
      };
    }),

  // ─── 管理员审核通过 → 充值积分 ─────────────────────
  approvePayment: protectedProcedure
    .input(
      z.object({
        submissionId: z.number().int().positive(),
        credits: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [admin] = await db
        .select({ role: users.role, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      if (!hasUnlimitedAccess({ role: admin?.role, email: admin?.email })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可审核" });
      }

      const [submission] = await db
        .select()
        .from(paymentSubmissions)
        .where(eq(paymentSubmissions.id, input.submissionId))
        .limit(1);
      if (!submission) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
      if (submission.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "订单已处理，请勿重复操作" });
      }

      if (submission.packageType.startsWith("trial199_")) {
        const approvedCount = await countTrial199SubmissionsForUser(db, submission.userId, ["approved"]);
        if (approvedCount >= TRIAL_PACK_199_MAX_PURCHASES_PER_USER) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `该用户试用包已通过审核 ${TRIAL_PACK_199_MAX_PURCHASES_PER_USER} 次，无法再批准此单`,
          });
        }
      }

      await addCredits(submission.userId, input.credits, "payment");
      await db
        .update(paymentSubmissions)
        .set({ status: "approved", reviewedBy: ctx.user.id, reviewedAt: new Date() })
        .where(eq(paymentSubmissions.id, input.submissionId));

      return {
        success: true,
        creditsAdded: input.credits,
        userId: submission.userId,
        message: `${COMPANY_NAME} 充值成功 ${input.credits} 积分`,
      };
    }),

  // ─── 管理员拒绝付款 ─────────────────────────────
  rejectPayment: protectedProcedure
    .input(
      z.object({
        submissionId: z.number().int().positive(),
        reason: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [admin] = await db
        .select({ role: users.role, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      if (!hasUnlimitedAccess({ role: admin?.role, email: admin?.email })) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await db
        .update(paymentSubmissions)
        .set({
          status: "rejected",
          rejectionReason: input.reason ?? null,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
        })
        .where(eq(paymentSubmissions.id, input.submissionId));

      return { success: true };
    }),

  // ─── 管理员查看待审核列表 ────────────────────────
  listPending: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [admin] = await db
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (!hasUnlimitedAccess({ role: admin?.role, email: admin?.email })) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return db
      .select()
      .from(paymentSubmissions)
      .where(eq(paymentSubmissions.status, "pending"))
      .orderBy(desc(paymentSubmissions.createdAt))
      .limit(100);
  }),

  // ─── 用户查看自己的付款历史 ─────────────────────
  myHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select()
      .from(paymentSubmissions)
      .where(eq(paymentSubmissions.userId, ctx.user.id))
      .orderBy(desc(paymentSubmissions.createdAt))
      .limit(30);
  }),
});
