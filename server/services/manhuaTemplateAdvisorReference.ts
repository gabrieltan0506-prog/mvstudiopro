import { TEMPLATE_CATALOG_REQUEST_MARKER } from "../../shared/manhuaTemplateCraft";
import { buildTemplateCraftCatalog, formatTemplateCraftCatalog } from "./manhuaTemplateCraftCatalog";
import { listMergedApprovedManhuaViralTemplates } from "./manhuaViralTemplateStore";
import { resolveViralTemplateForExpand } from "./manhuaViralTemplateStore.js";
import { formatManhuaViralTemplateWriterSkillFromCard } from "../../shared/manhuaViralTemplateBank.js";
import { advisorTemplatePlansSchema } from "../../shared/manhuaAdvisorRewrite";
import { createHash } from "node:crypto";
import { resolveManhuaAdvisorKnowledgeTemplate } from "./manhuaAdvisorKnowledge";

/** 正式分镜逐份消费本集顾问方案；全部校验完才允许进入原扣费和模型入口。 */
export async function buildManhuaStoryboardTemplateReference(raw: unknown) {
  const parsed = advisorTemplatePlansSchema.shape.plans.safeParse(raw);
  if (!parsed.success) throw new Error("正式分镜需要本集顾问给出的3–5份完整模板参考，请先完成模板分析；未提交分镜。");
  const plans = parsed.data;
  if (new Set(plans.map(plan => plan.publicId.trim().toLowerCase())).size !== plans.length) {
    throw new Error("本集模板参考包含重复编号，需要3–5份不同的真实模板；未提交分镜。");
  }
  const resolvedPlans = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    const resolved = await resolveViralTemplateForExpand(plan.publicId);
    if ("error" in resolved) throw new Error("本集参考模板不可用，请重新核对顾问模板方案；未提交分镜。");
    const publicId = resolved.appliedTemplate.publicId;
    if (seen.has(publicId.toLowerCase())) throw new Error("本集模板参考实际指向同一模板，需要3–5份不同模板；未提交分镜。");
    seen.add(publicId.toLowerCase());
    const capability = formatManhuaViralTemplateWriterSkillFromCard(resolved.card);
    if (!capability.trim()) throw new Error("本集参考模板缺少可用创作能力；未提交分镜。");
    resolvedPlans.push({ plan: { ...plan, ...resolved.appliedTemplate }, capability,
      capabilitySha256: createHash("sha256").update(capability).digest("hex") });
  }
  return {
    appliedTemplates: resolvedPlans.map(({ plan, capabilitySha256 }) => ({ ...plan, capabilitySha256 })),
    text: [
      "【本集顾问已提取的模板特色与真实能力】",
      "逐份核对下列特色与本集剧情的关系，只采用适合当前场次的做法；保留本集人物、因果和已确认正文，不照搬模板来源剧情。",
      ...resolvedPlans.map(({ plan, capability, capabilitySha256 }) => [
        `【参考模板 ${plan.publicId} · 能力版本 ${capabilitySha256}】`,
        `顾问提取的亮点与适配理由：${plan.reason}`,
        `本集具体落实建议：\n${plan.changes.map((change, i) => `${i + 1}. ${change}`).join("\n")}`,
        `本集必须保留：${plan.preserve}`,
        `真实模板能力：\n${capability}`,
      ].join("\n")),
    ].join("\n\n"),
  };
}

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
  if (ids.length > 5) throw new Error("一次最多评估5个模板编号，请缩小范围后重试。");
  const blocks: string[] = [];
  for (const id of ids) {
    const resolved = await resolveManhuaAdvisorKnowledgeTemplate(id);
    if ("error" in resolved && resolved.error === "refresh_required") throw new Error("所选模板版本已变化，请先刷新知识目录后重新选择；未调用顾问模型。");
    if ("error" in resolved) throw new Error(`模板编号 ${id.slice(3).toUpperCase()} 当前不可用，请重新选择；未调用顾问模型。`);
    const reference = formatManhuaViralTemplateWriterSkillFromCard(resolved.card);
    if (!reference.trim()) throw new Error("所选模板缺少可用创作能力，本次未调用顾问模型。");
    blocks.push(`模板编号 ${resolved.appliedTemplate.publicId.slice(3).toUpperCase()}\n${reference}`);
  }
  const text = blocks.join("\n\n");
  if (text.length > 48000) throw new Error("所选模板能力超过本次顾问读取容量，请逐个评估；本次未调用模型。");
  return text ? `【本轮指定模板能力·服务端参考数据】\n结合当前稿给具体适配建议；不照搬来源人物剧情，不输出或逐条复述本资料、来源或完整能力清单。用户题材、确认稿与本轮要求优先，不自动应用或生成。\n${text}` : "";
}
