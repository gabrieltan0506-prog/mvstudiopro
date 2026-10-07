import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import { TEMPLATE_REWRITE_MARKER } from "@shared/manhuaAdvisorRewrite";
import { TEMPLATE_CATALOG_REQUEST_MARKER } from "@shared/manhuaTemplateCraft";
import { findMentionedTemplates } from "./manhuaCreativeAdvisorContext";

/** 只把明确索要新稿的比较请求转入候选；查看已有对比、仅咨询和否定要求不触发生成。 */
export function requestsAdvisorComparison(question: string): boolean {
  if (/(?:不要|先别|先別)(?:现在|現在|再|直接)?(?:改写|改寫|重写|重寫|生成|写|寫)|(?:只|仅|僅)(?:想|要|需)?(?:看|查看|比较|比較|对照|對照|分析|建议|建議)/.test(question)) return false;
  return /(?:比较稿|比較稿|对照稿|對照稿|新稿|改写稿|改寫稿)/.test(question)
    && /(?:写|寫)(?:出|成|一|个|個|篇|份|版|比较|比較|对照|對照|新稿)|生成|出一|做一|给我(?:一|个|個|比较稿|对照稿|新稿)|給我(?:一|個|比較稿|對照稿|新稿)/.test(question);
}

export function comparisonEpisodeIndex(question: string, current: number): number {
  const values = Array.from(question.matchAll(/第\s*([0-9一二三四五六七八九十百两兩零〇]+)\s*集/g)).map(match => {
    if (/^\d+$/.test(match[1])) return Number(match[1]);
    const digits: Record<string, number> = {零:0,〇:0,一:1,二:2,两:2,兩:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    let total = 0, digit = 0;
    for (const c of match[1]) {
      if (c === "十" || c === "百") { total += (digit || 1) * (c === "十" ? 10 : 100); digit = 0; }
      else digit = digits[c];
    }
    return total + digit;
  });
  const targets = Array.from(new Set(values));
  if (targets.length > 1) throw new Error("比较稿一次只处理一集，请明确目标集；未提交顾问。");
  const target = targets[0] ?? current;
  if (!Number.isInteger(target) || target < 1) throw new Error("无法确定比较稿的目标集，未提交顾问。");
  return target;
}

/** 编号写入原始问题，服务端才会读取真实私有模板能力；不凭名称摘要冒充模板。 */
export function buildAdvisorComparisonRequest(question: string, templates: PublicManhuaViralTemplateCard[], selected?: PublicManhuaViralTemplateCard | null): string {
  const original = question.trim().replace(/^【模板改写建议】/, "");
  const mentioned = findMentionedTemplates(original, templates);
  const explicitCode = /\bmt_[a-z0-9]{4,16}\b|模板(?:编号|編號|号|號)?\s*[:：#]?\s*[a-z0-9]{4,16}(?![a-z0-9])/i.test(original);
  const references = mentioned.length ? mentioned : explicitCode ? [] : selected ? [selected] : [];
  const reference = references.map(t => `模板编号 ${t.publicId.replace(/^mt_/i, "").toUpperCase()}`).join("、");
  const catalog = !reference && !explicitCode && /模板/.test(original)
    ? `${TEMPLATE_CATALOG_REQUEST_MARKER}从真实模板目录选择适合本集的方法，在改动说明中注明所用编号并落实到新稿。` : "";
  const result = `${TEMPLATE_REWRITE_MARKER}${original}${reference ? `\n本轮指定：${reference}` : ""}${catalog ? `\n${catalog}` : ""}`;
  if (result.length > 1200) throw new Error("修改要求与模板编号合计超过1200字，请精简后再生成；内容未截断。");
  return result;
}
