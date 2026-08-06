/**
 * 静态收款码支付路由
 *
 * 流程：
 * 1. 用户选套餐 → getPaymentInfo 获取收款码图片路径 + 应付金额
 * 2. 用户扫码付款（微信/支付宝固定收款码）
 * 3. 用户点「我已付款」→ submitConfirmation 建 pending 单，拿到**收款编号**
 * 4. 用户点「发送付款截图」→ submitScreenshot 上传截图 → 识别 + 死规则判定
 *    - 判定通过：当场发积分，用户看到收据，不用等人
 *    - 判定存疑：留在 pending 队列，管理员 approvePayment 手动发（站点或识别通道挂了也走这条）
 *
 * 静态收款码没有支付平台回调，截图只是「用户声称已付」的强证据，不等于钱到账。
 * 所以自动放行的口子卡得很死（见 shared/paymentScreenshotVerify），且每一笔都留原图存档。
 *
 * 注意：收款码图片放到 public/assets/payment/ 目录下（需用户提供）
 */
import { z } from "zod";
import { and, count, desc, eq, inArray, like, sql } from "drizzle-orm";
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
import {
  buildPaymentOrderNo,
  decidePaymentScreenshot,
} from "../../shared/paymentScreenshotVerify";
import {
  archivePaymentScreenshot,
  hashScreenshot,
  PAYMENT_SCREENSHOT_MAX_BYTES,
  readPaymentScreenshot,
} from "../services/paymentScreenshotVerify";

/** 公司全称（付款后在微信/支付宝收款界面显示） */
export const COMPANY_NAME = "上海德智熙人工智能科技有限公司";

/** 静态收款码图片路径（用户需将图片放至 client/public/assets/payment/ 目录） */
const QR_IMAGE_PATHS = {
  wechat: "/assets/payment/wechat-collect.jpg",
  alipay: "/assets/payment/alipay-collect.jpg",
} as const;

type BillingCycle = "monthly" | "quarterly" | "yearly";
type PackId = keyof typeof CREDIT_PACKS;

/**
 * 新增列是后加的，线上表早就存在，所以在这里补列而不是靠迁移
 * （与 `betaCode` 里同样的做法）。跑一次就够，之后是 no-op。
 */
let columnsEnsured: Promise<void> | null = null;
async function ensurePaymentColumns(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  if (!columnsEnsured) {
    columnsEnsured = (async () => {
      await db.execute(sql`
        ALTER TABLE "payment_submissions"
        ADD COLUMN IF NOT EXISTS "order_no" VARCHAR(40),
        ADD COLUMN IF NOT EXISTS "credits_expected" INTEGER,
        ADD COLUMN IF NOT EXISTS "credits_granted" INTEGER,
        ADD COLUMN IF NOT EXISTS "screenshot_sha256" VARCHAR(64),
        ADD COLUMN IF NOT EXISTS "auto_verdict" TEXT,
        ADD COLUMN IF NOT EXISTS "auto_reason" TEXT,
        ADD COLUMN IF NOT EXISTS "auto_extract" TEXT,
        ADD COLUMN IF NOT EXISTS "auto_checked_at" TIMESTAMP
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "payment_submissions_order_no_idx"
        ON "payment_submissions" ("order_no")
      `);
    })().catch((err) => {
      // 补列失败不该让整个收款流程瘫掉；下次调用重试
      columnsEnsured = null;
      throw err;
    });
  }
  await columnsEnsured;
}

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
      message: `体验包每人最多购买 ${TRIAL_PACK_199_MAX_PURCHASES_PER_USER} 次（含待审核订单），您已达上限`,
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

export const staticPayRouter = router({
  // ─── 获取支付信息（QR 图片 + 应付金额）───────────────
  getPaymentInfo: protectedProcedure
    .input(
      z.object({
        packId: z.enum(["trial199", "medium", "large"]),
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
        packId: z.enum(["trial199", "medium", "large"]),
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

      await ensurePaymentColumns(db);
      const note = (input.transactionNote ?? "").trim();
      // 收款编号服务端生成：客户端传来的那串只当备注，不能让前端决定对账主键
      const orderNo = buildPaymentOrderNo(Date.now(), nanoid(6));
      const [row] = await db
        .insert(paymentSubmissions)
        .values({
          userId: ctx.user.id,
          packageType: `${input.packId}_${input.billingCycle}`,
          amount: String(expected.price),
          paymentMethod: input.method,
          screenshotUrl: note ? `note:${note}` : "",
          status: "pending",
          orderNo,
          creditsExpected: expected.credits,
        })
        .returning({ id: paymentSubmissions.id });

      return {
        success: true,
        submissionId: row?.id ?? null,
        orderNo,
        /** @deprecated 用 orderNo；保留字段避免旧前端崩 */
        orderId: orderNo,
        amount: expected.price,
        credits: expected.credits,
        message: "已收到付款确认。发送付款截图可立即到账，否则我们会尽快人工核对。",
      };
    }),

  // ─── 用户上传付款截图 → 识别 + 死规则判定 → 通过就当场到账 ───
  submitScreenshot: protectedProcedure
    .input(
      z.object({
        orderNo: z.string().min(1).max(40),
        /** 纯 base64（不带 data: 前缀） */
        imageBase64: z.string().min(64),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await ensurePaymentColumns(db);

      const [submission] = await db
        .select()
        .from(paymentSubmissions)
        .where(and(eq(paymentSubmissions.orderNo, input.orderNo), eq(paymentSubmissions.userId, ctx.user.id)))
        .limit(1);
      if (!submission) throw new TRPCError({ code: "NOT_FOUND", message: "找不到这笔订单，请重新提交付款确认" });
      if (submission.status === "approved") {
        return {
          verdict: "approved" as const,
          credited: 0,
          message: "这笔订单的积分已经到账了",
          orderNo: input.orderNo,
        };
      }
      if (submission.status === "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "这笔订单已关闭，请重新下单" });
      }

      const buf = Buffer.from(input.imageBase64, "base64");
      if (buf.byteLength === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "截图读取失败，请重新选择" });
      if (buf.byteLength > PAYMENT_SCREENSHOT_MAX_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "截图太大了，请直接用手机截图原图" });
      }

      const sha = hashScreenshot(buf);
      const [dupe] = await db
        .select({ id: paymentSubmissions.id, orderNo: paymentSubmissions.orderNo })
        .from(paymentSubmissions)
        .where(
          and(
            eq(paymentSubmissions.screenshotSha256, sha),
            eq(paymentSubmissions.status, "approved"),
          ),
        )
        .limit(1);
      const duplicate = Boolean(dupe && dupe.id !== submission.id);

      const gcsUri = await archivePaymentScreenshot({ buf, mimeType: input.mimeType, orderNo: input.orderNo });

      const orderCreatedAtMs = submission.createdAt ? new Date(submission.createdAt).getTime() : Date.now();
      // 东八区当天日期，给模型补「只有时分没有日期」的截图
      const dateHint = new Date(orderCreatedAtMs + 8 * 3600_000).toISOString().slice(0, 10);

      let extract;
      try {
        extract = await readPaymentScreenshot({
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
          dateHint,
        });
      } catch (err) {
        // 识别通道挂了不能让用户卡住：留在人工队列，照旧能手动发
        console.error("[staticPay] 截图识别失败", { orderNo: input.orderNo, err });
        await db
          .update(paymentSubmissions)
          .set({
            screenshotUrl: gcsUri ?? submission.screenshotUrl,
            screenshotSha256: sha,
            autoVerdict: "review",
            autoReason: "识别通道异常，转人工",
            autoCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentSubmissions.id, submission.id));
        return {
          verdict: "review" as const,
          credited: 0,
          message: "截图已收到，我们会尽快人工核对后为你充值。",
          orderNo: input.orderNo,
        };
      }

      const expectedAmount = Number(submission.amount);
      const decision = decidePaymentScreenshot({
        extract,
        expectedAmountCny: expectedAmount,
        orderCreatedAtMs,
        nowMs: Date.now(),
        duplicate,
      });

      const credits = Number(submission.creditsExpected ?? 0);
      const shouldCredit = decision.verdict === "approved" && credits > 0;
      if (shouldCredit) {
        await addCredits(submission.userId, credits, "payment");
      }

      await db
        .update(paymentSubmissions)
        .set({
          screenshotUrl: gcsUri ?? submission.screenshotUrl,
          screenshotSha256: sha,
          autoVerdict: decision.verdict,
          autoReason: decision.reason,
          autoExtract: JSON.stringify({ ...extract, txnId: extract.txnId, checks: decision.checks }),
          autoCheckedAt: new Date(),
          ...(shouldCredit
            ? { status: "approved", creditsGranted: credits, reviewedAt: new Date() }
            : {}),
          ...(decision.verdict === "rejected" ? { rejectionReason: decision.reason } : {}),
          updatedAt: new Date(),
        })
        .where(eq(paymentSubmissions.id, submission.id));

      if (shouldCredit) {
        return {
          verdict: "approved" as const,
          credited: credits,
          message: `已到账 ${credits} 积分`,
          orderNo: input.orderNo,
        };
      }
      if (decision.verdict === "rejected") {
        return {
          verdict: "rejected" as const,
          credited: 0,
          message: "这张截图之前用过了，请上传本次付款的截图。",
          orderNo: input.orderNo,
        };
      }
      return {
        verdict: "review" as const,
        credited: 0,
        message: "截图已收到，我们会尽快人工核对后为你充值。",
        orderNo: input.orderNo,
      };
    }),

  // ─── 收据（凭收款编号查，付款成功页与「下载收据」都读它）───
  receipt: protectedProcedure
    .input(z.object({ orderNo: z.string().min(1).max(40) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await ensurePaymentColumns(db);
      const [row] = await db
        .select()
        .from(paymentSubmissions)
        .where(and(eq(paymentSubmissions.orderNo, input.orderNo), eq(paymentSubmissions.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到这笔订单" });
      return {
        orderNo: row.orderNo,
        companyName: COMPANY_NAME,
        amount: Number(row.amount),
        credits: Number(row.creditsGranted ?? row.creditsExpected ?? 0),
        method: row.paymentMethod === "wechat" ? "微信支付" : "支付宝",
        status: row.status,
        paidAt: row.reviewedAt ?? row.createdAt,
        createdAt: row.createdAt,
        /** 只有到账了才算正式收据；待核对时前端显示「核对中」 */
        settled: row.status === "approved",
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
            message: `该用户体验包已通过审核 ${TRIAL_PACK_199_MAX_PURCHASES_PER_USER} 次，无法再批准此单`,
          });
        }
      }

      await addCredits(submission.userId, input.credits, "payment");
      await db
        .update(paymentSubmissions)
        .set({
          status: "approved",
          creditsGranted: input.credits,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
        })
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
