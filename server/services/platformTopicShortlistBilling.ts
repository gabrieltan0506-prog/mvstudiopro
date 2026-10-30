import { nanoid } from "nanoid";
import { deductCreditsAmount, refundCreditsForDeductAmount } from "../credits";
import { canonicalRefundKey, heartbeatActiveJob, markSettlementPending, refundCreditsOnFailure, registerActiveJob, unregisterActiveJob } from "./paidJobLedger";

/** 初选内容校验失败同样走同源退还；价格、管理员豁免和免费额度不变。 */
export async function withTopicShortlistCharge<T>(
  input: { userId: number; cost: number; count: number; exempt: boolean }, work: () => Promise<T>,
): Promise<T> {
  if (input.exempt) return work();
  const jobId = nanoid(16), taskType = "platformTopicShortlist";
  const deduct = await deductCreditsAmount(input.userId, input.cost, taskType,
    `选题初选 ${input.count} 条`, { chargeKey: `${taskType}/${input.userId}/${jobId}` });
  try {
    await registerActiveJob({ jobId, taskType, userId: input.userId, creditsBilled: deduct.cost,
      action: "选题初选", deduct });
  } catch (error) {
    await refundCreditsForDeductAmount(input.userId, "选题任务登记失败退还", deduct,
      "platformTopicShortlistRefund", { refundKey: canonicalRefundKey(taskType, jobId) });
    throw error;
  }
  const timer = setInterval(() => { void heartbeatActiveJob(jobId, taskType).catch(error => console.error("[topicShortlist] 心跳失败", error)); }, 30_000);
  try {
    let result: T;
    try { result = await work(); }
    catch (error) {
      // 失败回执保留在账本，退还失败由已有补偿器继续处理。
      await refundCreditsOnFailure(jobId, taskType, "task_failed", error instanceof Error ? error.message : "选题失败")
        .catch(refundError => console.error("[topicShortlist] 退还待补偿", refundError));
      throw error;
    }
    try { await unregisterActiveJob(jobId, taskType); }
    catch { await markSettlementPending(jobId, taskType); }
    return result;
  } finally { clearInterval(timer); }
}
