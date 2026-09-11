import { and, eq, like, or } from "drizzle-orm";
import { stripeUsageLogs } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { deductCreditsAmount } from "../credits.js";
import { recordKnowledgeCardDistillReceipt } from "../services/knowledgeCardDistillReceipt.js";
import type { KnowledgeCardSettlementCheckpoint } from "./repository.js";

/** 只消费已持久化的成稿；恢复时禁止重新调用模型。扣费键沿用旧任务契约。 */
export async function settleKnowledgeCardCheckpoint(
  jobId: string,
  userId: number,
  checkpoint: KnowledgeCardSettlementCheckpoint,
): Promise<Record<string, unknown>> {
  if (!jobId || !Number.isInteger(userId) || userId <= 0) {
    throw new Error("知识卡结算缺少有效任务或用户身份");
  }
  if (checkpoint.receiptModel) {
    await recordKnowledgeCardDistillReceipt(userId, checkpoint.receiptModel, checkpoint.markdown);
  }
  let distillFeeCharged = 0;
  if (checkpoint.fee > 0) {
    const db = await getDb();
    if (!db) throw new Error("知识卡结算对账暂不可用，成稿已保留");
    const chargeKey = `[chargeKey:kcdistill/${jobId}]`;
    // 旧账可能仅在 description 中记录键；新账使用同一唯一键，保留旧账兼容。
    const [prior] = await db.select({ creditsCost: stripeUsageLogs.creditsCost })
      .from(stripeUsageLogs)
      .where(and(eq(stripeUsageLogs.userId, userId), or(
        eq(stripeUsageLogs.chargeKey, chargeKey),
        like(stripeUsageLogs.description, `%${chargeKey}%`),
      )))
      .limit(1);
    if (prior) {
      distillFeeCharged = Math.max(0, Number(prior.creditsCost) || 0);
    } else {
      const charged = await deductCreditsAmount(
        userId,
        checkpoint.fee,
        "knowledgeCardDistill",
        `图文知识卡·提炼（${Number(checkpoint.output.sourceChars || 0).toLocaleString()} 字 → ${Number(checkpoint.output.pageCount || 0)} 页）${chargeKey}`,
        { chargeKey },
      );
      distillFeeCharged = charged.cost;
    }
  }
  return { ...checkpoint.output, distillFeeCharged };
}
