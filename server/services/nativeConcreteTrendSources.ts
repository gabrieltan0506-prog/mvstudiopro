import type { ConcreteSource } from "../../shared/concreteTrendReport";
import type { TrendItem } from "../growth/trendCollector";

/** B站原库到案例报告的边界：不补作者、不把采集时间当发布时间、不把缺指标补零。 */
export function buildNativeConcreteSources(platform: ConcreteSource["platform"], items: TrendItem[], startMs: number, endMs: number, limit = 40): ConcreteSource[] {
  const byId = new Map<string, ConcreteSource>();
  const metric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  for (const item of items) {
    const at = Date.parse(item.publishedAt || "");
    if (!item.id?.trim() || !item.title?.trim() || !item.author?.trim() || !Number.isFinite(at) || at < startMs || at >= endMs) continue;
    const source: ConcreteSource = {
      id:item.id, platform,title:item.title, description:item.title,
      author:item.author,authorId:"",url:item.url || null,publishedAt:new Date(at).toISOString(),
      likes:metric(item.likes),comments:metric(item.comments),shares:metric(item.shares),views:metric(item.views),
      query:undefined,
    };
    const previous = byId.get(item.id);
    if (!previous || (source.views ?? source.likes ?? 0) > (previous.views ?? previous.likes ?? 0)) byId.set(item.id,source);
  }
  return Array.from(byId.values()).sort((a,b)=>(b.likes ?? b.views ?? 0)-(a.likes ?? a.views ?? 0) || (b.views ?? 0)-(a.views ?? 0)).slice(0,limit);
}

export function buildBilibiliConcreteSources(items: TrendItem[], startMs: number, endMs: number, limit = 40) {
 return buildNativeConcreteSources("bilibili", items, startMs, endMs, limit);
}

/** 同平台合并全部真实作品，外部来源优先保留完整文案，不因原库已有ID丢弃内容。 */
export function mergeConcreteSources(native: ConcreteSource[], external: ConcreteSource[], limit = 40): ConcreteSource[] {
  const merged = new Map(native.map(s => [s.id, s]));
  for (const s of external) {
    const previous = merged.get(s.id);
    merged.set(s.id, previous ? { ...previous, ...s } : s);
  }
  return Array.from(merged.values()).sort((a,b) => (b.likes ?? b.views ?? 0)-(a.likes ?? a.views ?? 0) || (b.views ?? 0)-(a.views ?? 0)).slice(0, limit);
}
