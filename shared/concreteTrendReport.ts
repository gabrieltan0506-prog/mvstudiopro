export type ConcreteTrendExample = { id: string; platform: string; author: string; title: string;
  description?: string; publishedAt: string | null; angle?: string; structure?: string; adaptation?: string; likes?: number | null; comments?: number | null; shares?: number | null; views?: number | null };
export type ConcreteTrendData = {
  reportTitle: string; dateRange: string; platformLabel: string;
  themes: Array<{ primary: string; secondary: string[] }>;
  examples: ConcreteTrendExample[];
  suggestions: Array<{ title: string; detail: string }>;
  growth: Array<{ name: string; growth: string }>;
  insights?: Array<{ title: string; detail: string }>;
  audiences?: Array<{ name: string; need: string; direction: string }>;
  metrics?: Array<{ name: string; rate: number; detail: string }>;
  evidenceNote?: string;
  metricsTitle?: string; metricsExplanation?: string;
  metricKind?: "interactionRate" | "topicShare" | "likeShare" | "none" | "auto";
};

import { z } from "zod";
import type { GuaikeiItem } from "./guaikei";
const nonempty = z.string().trim().min(1).max(1200);
/** 只接有来源ID的具体内容；百分比由真实源数据计算，模型不能填热度。 */
export const concreteEditorialSchema = z.object({
  insights: z.array(z.object({ title: nonempty, detail: nonempty })).min(2).max(4),
  themes: z.array(z.object({ primary: nonempty, secondary: z.array(nonempty).min(1).max(5) })).min(2).max(8),
  examples: z.array(z.object({ id: nonempty, title: nonempty, description: nonempty,
    angle: nonempty, structure: nonempty, adaptation: nonempty })).min(2).max(8),
  audiences: z.array(z.object({ name: nonempty, need: nonempty, direction: nonempty })).min(2).max(4),
  suggestions: z.array(z.object({ title: nonempty, detail: nonempty })).min(2).max(8),
  assignments: z.array(z.object({ id: nonempty, topic: nonempty })).min(1).max(1000),
});
export type ConcreteEditorial = z.infer<typeof concreteEditorialSchema>;
export type ConcreteSource = Omit<GuaikeiItem, "platform"> & { platform: GuaikeiItem["platform"] | "bilibili"; query?: string };
/** 条图仅比较有完整分母的真实作品互动率，不把分类数量或点赞份额当增长。 */
export function concreteReportPolicy(sources: ConcreteSource[]) {
  const eligible = sources.filter(s => typeof s.views === "number" && Number.isFinite(s.views) && s.views > 0
    && [s.likes,s.comments,s.shares].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0)
    && (s.likes! + s.comments! + s.shares!) > 0);
  const hasChart = sources.length >= 8 && new Set(eligible.map(s => s.author)).size >= 4;
  return { metricKind: hasChart ? "interactionRate" as const : "none" as const,
    exampleCount: hasChart ? 4 : Math.min(8, sources.length), suggestionCount: hasChart ? 4 : 8,
    eligibleIds: hasChart ? eligible.map(s => s.id) : sources.map(s => s.id) };
}

export function assembleConcreteTrendReport(raw: unknown, sources: ConcreteSource[], meta: {
  reportTitle: string; dateRange: string; platformLabel: string; metricKind: "topicShare" | "interactionRate" | "likeShare" | "none" | "auto";
  metricsTitle?: string; metricsExplanation?: string;
}): ConcreteTrendData {
  const editorial = concreteEditorialSchema.parse(raw);
  const isCurrent = meta.metricKind === "auto";
  const policy = concreteReportPolicy(sources);
  if (isCurrent) {
    if (editorial.examples.length !== policy.exampleCount || editorial.suggestions.length !== policy.suggestionCount)
      throw Error("案例与选题数量不符合本次内容版式");
    if (policy.metricKind === "interactionRate" && editorial.examples.some(e => !policy.eligibleIds.includes(e.id))) throw Error("条图案例缺少完整可比互动指标");
    if (policy.metricKind === "interactionRate" && new Set(editorial.examples.map(e => sources.find(s => s.id === e.id)?.author)).size < 4)
      throw Error("条图需要四位不同作者的真实作品");
  }
  meta = { ...meta, metricKind: isCurrent ? policy.metricKind : meta.metricKind };
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  if (!sources.length || sourceMap.size !== sources.length || new Set(sources.map(s => s.platform)).size !== 1) throw Error("内容报告来源必须非空、同平台且去重");
  const assigned = new Set<string>(), counts = new Map<string, number>();
  for (const a of editorial.assignments) {
    if (!sourceMap.has(a.id) || assigned.has(a.id)) throw Error("话题分类引用了未知或重复作品");
    assigned.add(a.id); counts.set(a.topic, (counts.get(a.topic) || 0) + 1);
  }
  if (assigned.size !== sourceMap.size) throw Error("话题分类遗漏作品，不能缩小分母");
  const examples: ConcreteTrendExample[] = [], exampleIds = new Set<string>();
  for (const e of editorial.examples) {
    const source = sourceMap.get(e.id);
    if (!source || exampleIds.has(e.id) || !source.author || !source.title || !source.publishedAt) throw Error("博主例子缺少真实来源或重复");
    exampleIds.add(e.id);
    examples.push({ ...e, platform: source.platform, author: source.author, publishedAt: source.publishedAt, likes: source.likes, comments: source.comments, shares: source.shares, views: source.views });
  }
  const queries = Array.from(new Set(sources.map(s => s.query).filter(Boolean))).join("、");
  const likeTotal = examples.reduce((sum,e) => sum + (sourceMap.get(e.id)!.likes || 0), 0);
  if (meta.metricKind === "likeShare" && (!likeTotal || examples.some(e => sourceMap.get(e.id)!.likes === null))) throw Error("入选作品缺少点赞份额计算字段");
  const metrics = meta.metricKind === "none" ? [] : meta.metricKind === "topicShare"
    ? Array.from(counts.entries()).sort((a,b) => b[1]-a[1]).map(([name,count]) => ({ name, rate: count / sources.length * 100, detail: "按作品主话题互斥归类" }))
    : meta.metricKind === "likeShare" ? examples.map(e => ({ name: e.author, rate: sourceMap.get(e.id)!.likes! / likeTotal * 100, detail: e.title }))
    : examples.flatMap(e => {
      const s=sourceMap.get(e.id)!;
      if (s.views === null || s.views <= 0 || [s.likes,s.comments,s.shares].some(v=>v===null || !Number.isFinite(v) || v! < 0)) return [];
      return [{ name: s.author, rate: (s.likes!+s.comments!+s.shares!) / s.views * 100, detail: e.title }];
    });
  if (meta.metricKind === "interactionRate" && metrics.length !== examples.length) throw Error("入选作品缺少互动率计算字段");
  return { ...meta, themes: editorial.themes, examples, insights: editorial.insights, audiences: editorial.audiences,
    suggestions: editorial.suggestions, growth: [], metrics,
    evidenceNote: isCurrent ? (meta.metricKind === "interactionRate" ? "累计互动率用于比较作品表现，不代表题材增长率。" : "") : `来源范围：${queries || "已选择的真实作品"}。${meta.metricKind === "topicShare" ? "占比只描述本报告所选资料，受检索词与筛选影响；不是平台全量热度或增长率。" : meta.metricKind === "likeShare" ? "点赞份额仅比较入选作品，不代表全平台热度、增长或互动率。" : "累计互动率用于比较入选作品，不是增长率，也不能证明内容因果。"}` };
}
