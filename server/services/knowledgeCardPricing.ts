import { resolveKnowledgeCardDistillModel, knowledgeCardPageCreditsForModel } from "../../shared/knowledgeCardDistillModels";
import { knowledgeCardCreditsForPages, knowledgeCardCreditsForPageIndex, planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import { lookupKnowledgeCardDistillReceiptModel } from "./knowledgeCardDistillReceipt";

/** 报价与扣费共用真实读档账本；历史ID保留原价，新手写稿只能选择现行两档。 */
export async function quoteKnowledgeCard(
  userId: number,
  markdown: string,
  selectedModel?: string,
  lookup = lookupKnowledgeCardDistillReceiptModel,
) {
  const receiptModel = await lookup(userId, markdown);
  const billingModel = receiptModel || resolveKnowledgeCardDistillModel(selectedModel);
  const pageCount = planKnowledgeCardPages(markdown, billingModel).pageCount;
  const prices = knowledgeCardPageCreditsForModel(billingModel);
  return {
    billingModel,
    hasReceipt: Boolean(receiptModel),
    pageCount,
    credits: knowledgeCardCreditsForPages(pageCount, billingModel),
    prices,
  };
}

export function assertKnowledgeCardConfirmedPrice(billingModel: string, page: number, confirmed: number | undefined) {
  const price = knowledgeCardCreditsForPageIndex(page, billingModel);
  if (confirmed !== price) throw new Error("本页报价已变化或尚未确认，请重新确认费用；未扣费、未提交出图");
  return price;
}

/** 分页与实际出图切片共用同一正文，防止越界页码享受第九页折扣。 */
export function assertKnowledgeCardPageSelection(markdown: string, billingModel: string, index?: number, total?: number) {
  if (index === undefined && total === undefined) return;
  const count = planKnowledgeCardPages(markdown, billingModel).pageCount;
  if (!Number.isSafeInteger(index) || !index || index < 1 || index > count || (total !== undefined && total !== count)) {
    throw new Error("出图页码与当前稿件不一致，请重新确认；未扣费、未提交出图");
  }
}
