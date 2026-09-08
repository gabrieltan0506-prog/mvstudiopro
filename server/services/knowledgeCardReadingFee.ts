import { knowledgeCardDistillFeeForModel, type ActiveKnowledgeCardDistillModelId } from "../../shared/knowledgeCardDistillModels.js";
import { deductCreditsAmount, readCreditsChargeByKey } from "../credits.js";
import { knowledgeReadingPrefix, readKnowledgeReadingJson, saveKnowledgeReadingObject } from "./knowledgeCardReadingStore.js";
import { KNOWLEDGE_CARD_READING_CONTRACT } from "./knowledgeCardReading.js";

/** 保留既有手输长文主动提炼费；文档上传不收，换预算方案不再次收取同一份阅读费。 */
export async function settleKnowledgeCardReadingFee(input: {
  userId: number; analysisId: string; model: ActiveKnowledgeCardDistillModelId; chargeDistillFee: boolean;
}): Promise<number> {
  if (!/^[a-f0-9]{64}$/.test(input.analysisId)) throw new Error("阅读计费身份无效");
  const objectName = `${knowledgeReadingPrefix(input.userId)}${KNOWLEDGE_CARD_READING_CONTRACT}/${input.analysisId}/preparation-fee.json`;
  const previous = await readKnowledgeReadingJson<{ credits: number }>(objectName);
  if (previous) {
    if (!Number.isFinite(previous.credits) || previous.credits < 0) throw new Error("阅读费用回执无效");
    return previous.credits;
  }
  if (!input.chargeDistillFee) return 0;
  const chargeKey = `knowledgeCardReading/${input.userId}/${input.analysisId}`;
  // 原账已扣但对象回执写入失败时，直接恢复原金额，不要求余额再次满足同一笔费用。
  const previousCharge = await readCreditsChargeByKey(input.userId, chargeKey);
  const receipt = previousCharge ?? await deductCreditsAmount(input.userId, knowledgeCardDistillFeeForModel(input.model), "knowledgeCardDistill", "图文知识卡·手输长文精读与方案", {
    chargeKey,
  });
  await saveKnowledgeReadingObject(objectName, Buffer.from(JSON.stringify({ credits: receipt.cost })));
  return receipt.cost;
}
