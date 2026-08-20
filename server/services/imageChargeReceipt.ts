/**
 * 图片生成预扣收据(五审 P0-2):服务端签发、可校验、只能消费一次。
 *
 * 背景:canvas_gpt_image2 队列此前由客户端 params.chargeOnServer 决定是否扣费——
 * 攻击者省略该标记即可免费调用付费上游。修法:worker 一律扣费,唯一豁免是
 * "已在服务端预扣"的证据 = 本模块签发的一次性收据(/creative、/platform 前端
 * chargeStep 预扣成功后由服务端发放)。
 *
 * 实现骑在 stripe_usage_logs.chargeKey 全局唯一索引上,不需要新表:
 * - 签发:预扣成功后插入 creditsCost=0 的标记行,chargeKey=`imgrcpt:<uuid>`;
 * - 消费:插入 chargeKey=`imgrcpt-used:<uuid>` 的标记行——唯一索引保证并发/重放
 *   只有一腿成功;第二次消费必撞唯一约束返回 false。
 * - 校验:签发行必须存在且 userId 匹配(收据不可转让)。
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { stripeUsageLogs } from "../../drizzle/schema";
import { getDb } from "../db";

const ISSUE_PREFIX = "imgrcpt:";
const CONSUME_PREFIX = "imgrcpt-used:";
/** 收据有效期:超过即拒收,防长期囤积 */
const RECEIPT_TTL_MS = 6 * 3600_000;

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /stripe_usage_logs_charge_key_uniq|duplicate key value/i.test(msg);
}

export type ReceiptDbOps = {
  insertMarker: (row: {
    userId: number;
    action: string;
    chargeKey: string;
    description: string;
  }) => Promise<void>;
  findIssued: (
    userId: number,
    chargeKey: string,
  ) => Promise<{ createdAt: Date | string } | null>;
};

async function defaultOps(): Promise<ReceiptDbOps | null> {
  const db = await getDb();
  if (!db) return null;
  return {
    async insertMarker(row) {
      await db.insert(stripeUsageLogs).values({
        userId: row.userId,
        action: row.action,
        creditsCost: 0,
        isFreeQuota: 1,
        description: row.description,
        chargeKey: row.chargeKey,
      });
    },
    async findIssued(userId, chargeKey) {
      const [r] = await db
        .select({ createdAt: stripeUsageLogs.createdAt })
        .from(stripeUsageLogs)
        .where(and(eq(stripeUsageLogs.userId, userId), eq(stripeUsageLogs.chargeKey, chargeKey)))
        .limit(1);
      return r || null;
    },
  };
}

/** 预扣成功后签发;DB 不可用时抛错(fail-closed:发不了收据就别宣称已预扣) */
export async function issueImageChargeReceipt(input: {
  userId: number;
  reason: string;
  ops?: ReceiptDbOps;
}): Promise<string> {
  const ops = input.ops || (await defaultOps());
  if (!ops) throw new Error("image_charge_receipt_db_unavailable");
  const receiptId = randomUUID();
  await ops.insertMarker({
    userId: input.userId,
    action: "imageChargeReceipt",
    chargeKey: `${ISSUE_PREFIX}${receiptId}`,
    description: String(input.reason || "").slice(0, 200),
  });
  return receiptId;
}

/**
 * 校验并原子消费。true=收据有效且本次是唯一一次消费;
 * false=收据不存在/不属于该用户/过期/已被消费——调用方应回退为正常扣费或拒绝。
 */
export async function consumeImageChargeReceipt(input: {
  userId: number;
  receiptId: string;
  ops?: ReceiptDbOps;
}): Promise<boolean> {
  const receiptId = String(input.receiptId || "").trim();
  const userId = Number(input.userId);
  if (!/^[0-9a-f-]{16,64}$/i.test(receiptId) || !Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  const ops = input.ops || (await defaultOps());
  if (!ops) return false; // fail-closed:验不了就当无收据,走正常扣费
  const issued = await ops.findIssued(userId, `${ISSUE_PREFIX}${receiptId}`);
  if (!issued) return false;
  if (Date.now() - new Date(issued.createdAt).getTime() > RECEIPT_TTL_MS) return false;
  try {
    await ops.insertMarker({
      userId,
      action: "imageChargeReceiptConsume",
      chargeKey: `${CONSUME_PREFIX}${receiptId}`,
      description: "canvas_gpt_image2 预扣收据核销",
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false; // 已被消费(并发另一腿/重放)
    throw error;
  }
}

/**
 * 画布超时重试的一次性免扣核销:每个首单 jobId 只允许豁免一次。
 * true=本次豁免成立;false=该首单已豁免过(重放)或 DB 不可用(fail-closed 照常扣费)。
 * 首单资格校验(同用户/同 action/非豁免单)由调用方在核销前完成。
 */
export async function claimCanvasRetryChargeWaiver(input: {
  userId: number;
  retryOfJobId: string;
  ops?: ReceiptDbOps;
}): Promise<boolean> {
  const retryOf = String(input.retryOfJobId || "").trim();
  const userId = Number(input.userId);
  if (!retryOf || retryOf.length > 64 || !Number.isFinite(userId) || userId <= 0) return false;
  const ops = input.ops || (await defaultOps());
  if (!ops) return false;
  try {
    await ops.insertMarker({
      userId,
      action: "canvasImageRetryWaiver",
      chargeKey: `imgretry-used:${retryOf}`,
      description: "canvas_gpt_image2 超时重试免扣核销",
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
