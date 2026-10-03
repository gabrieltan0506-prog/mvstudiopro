import { TEMPLATE_CATALOG_REQUEST_MARKER } from "../../shared/manhuaTemplateCraft";
import { buildTemplateCraftCatalog, formatTemplateCraftCatalog } from "./manhuaTemplateCraftCatalog";
import { listMergedApprovedManhuaViralTemplates } from "./manhuaViralTemplateStore";
import { resolveViralTemplateForExpand } from "./manhuaViralTemplateStore.js";
import { formatManhuaViralTemplateWriterSkillFromCard } from "../../shared/manhuaViralTemplateBank.js";

/** 只从本轮原始问题取明确编号，不从历史或推荐列表自动装入其它模板。 */
export function mentionedManhuaTemplateIds(question: string): string[] {
  if (!/模板|编号|編號|\bmt_/i.test(question)) return [];
  const ids = new Set<string>();
  const pattern = /\bmt_([a-z0-9]{4,16})\b|模板(?:编号|編號|号|號)?\s*[:：#]?\s*([a-z0-9]{4,16})(?![a-z0-9])|\b([A-F0-9]{4,16})\b/g;
  for (const match of Array.from(question.matchAll(pattern))) {
    const code = match[1] || match[2] || match[3];
    if (!code || (match[3] && !(/\d/.test(code) && /[A-Z]/.test(code)))) continue;
    ids.add(`mt_${code.toLowerCase()}`);
  }
  return Array.from(ids);
}

/** 完整能力只进服务端LLM消息；不将私有卡、来源或能力全文返回公开目录。 */
export async function buildManhuaTemplateAdvisorReference(question: string): Promise<string> {
  if (question.includes(TEMPLATE_CATALOG_REQUEST_MARKER)) {
    const { catalog } = buildTemplateCraftCatalog(await listMergedApprovedManhuaViralTemplates());
    if (catalog.length < 3) throw new Error("可用模板不足3个，未调用顾问模型。");
    return formatTemplateCraftCatalog(catalog);
  }
  const ids = mentionedManhuaTemplateIds(question);
  if (ids.length > 3) throw new Error("一次最多评估3个模板编号，请缩小范围后重试。");
  const blocks: string[] = [];
  for (const id of ids) {
    const resolved = await resolveViralTemplateForExpand(id);
    if ("error" in resolved) throw new Error(`模板编号 ${id.slice(3).toUpperCase()} 当前不可用，请重新选择；未调用顾问模型。`);
    const reference = formatManhuaViralTemplateWriterSkillFromCard(resolved.card);
    if (!reference.trim()) throw new Error("所选模板缺少可用创作能力，本次未调用顾问模型。");
    blocks.push(`模板编号 ${resolved.appliedTemplate.publicId.slice(3).toUpperCase()}\n${reference}`);
  }
  const text = blocks.join("\n\n");
  if (text.length > 48000) throw new Error("所选模板能力超过本次顾问读取容量，请逐个评估；本次未调用模型。");
  return text ? `【本轮指定模板能力·服务端参考数据】\n结合当前稿给具体适配建议；不照搬来源人物剧情，不输出或逐条复述本资料、来源或完整能力清单。用户题材、确认稿与本轮要求优先，不自动应用或生成。\n${text}` : "";
}
