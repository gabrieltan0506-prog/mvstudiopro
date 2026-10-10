import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
import { formatManhuaViralTemplateWriterSkillFromCard } from "../../shared/manhuaViralTemplateBank";

export type TemplateEvidence = { field: string; offset: number; text: string };
/** 只索引创作字段，原字幕、素材地址、来源及供应商回执不进入检索。长字段完整分块，不静默截断。 */
export function extractTemplateEvidence(card: ManhuaViralTemplateCard): TemplateEvidence[] {
  const evidence: TemplateEvidence[] = [];
  const add = (field: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    for (let offset = 0; offset < value.length; offset += 1200) evidence.push({ field, offset, text: value.slice(offset, offset + 1200) });
  };
  add("writerCapability", formatManhuaViralTemplateWriterSkillFromCard(card));
  const fields = ["shotSizeZh", "angleZh", "compositionZh", "cameraMoveZh", "blockingZh", "bodyActionZh", "limbPropActionZh", "microExpressionZh", "gazeBreathZh", "relationshipReactionZh", "lightingZh", "transitionInZh"] as const;
  card.beatGrid.forEach((beat, i) => fields.forEach(field => add(`beatGrid[${i}].${field}`, beat[field])));
  return evidence;
}
function terms(value: string): Set<string> {
  const result = new Set<string>();
  for (const match of Array.from(value.toLowerCase().matchAll(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g))) {
    const word = match[0];
    if (/^[a-z0-9_]+$/.test(word)) result.add(word);
    else for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
  }
  for (const stop of ["如何","什么","怎么","当前","这个","一个","进行","可以","需要","请问","我们","他们","模板","顾问","建议","的时"]) result.delete(stop);
  return result;
}
/** 全库检索、有限原文选读；覆盖数与实际选读范围分开，不能声称模型已训练全库。 */
export function rankTemplateEvidence(rows: { publicId: string; evidence: TemplateEvidence[] }[], question: string, story = "") {
  const generic = /建议|建议|优化|改进|帮我|帮忙|看看|继续/.test(question);
  const query = terms(question), context = terms(story);
  if (generic) for (const term of Array.from(context)) query.add(term);
  const documentFrequency = new Map<string, number>();
  for (const row of rows) {
    const text = row.evidence.map(e => e.text).join("\n").toLowerCase();
    for (const term of Array.from(query)) if (text.includes(term)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  return rows.map(row => {
    const ranked = row.evidence.map(item => {
      const text = item.text.toLowerCase();
      let score = 0;
      for (const term of Array.from(query)) if (text.includes(term)) score += 1 + Math.log(1 + rows.length / (documentFrequency.get(term) || 1));
      // 正文只帮助同主题排序，不会单凭故事命中把无关问题变成模板推荐。
      if (score) for (const term of Array.from(context)) if (text.includes(term)) score += 0.02;
      return { ...item, score };
    }).filter(item => item.score > 0).sort((a,b) => b.score - a.score || a.field.localeCompare(b.field) || a.offset - b.offset);
    return { publicId: row.publicId, score: ranked[0]?.score || 0, evidence: ranked.slice(0, 4).map(({ score: _, ...item }) => item), availableChunks: row.evidence.length };
  }).filter(row => row.score > 0).sort((a,b) => b.score - a.score || a.publicId.localeCompare(b.publicId)).slice(0, 3);
}
