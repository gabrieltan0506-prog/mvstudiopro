import { describe, it, expect } from 'vitest';
import { buildGrowthStatusProjection } from './growthStatusProjection';
import { summarizeTrendWindowCounts } from './trendWindow';
import type { PlatformTrendCollection } from './trendCollector';

describe('轻量状态投影', () => {
  it.each([0, 7, 8, 15])('保留窗口规则，%i条近期有日期样本', count => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
    const items = [...Array.from({length: count}, (_,i) => ({title:`新${i}`, publishedAt:daysAgo(5), likes:i})),
      {title:'无日期', likes:999}, {title:'20天',publishedAt:daysAgo(20)}, {title:'旧',publishedAt:daysAgo(60)}];
    const collection = {items, collectedAt:'2026-10-06T00:00:00Z'} as PlatformTrendCollection;
    const result = buildGrowthStatusProjection(collection);
    expect(result.windowItems15d).toBe(summarizeTrendWindowCounts(collection.items,15).windowFiltered);
    expect(result.windowItems30d).toBe(summarizeTrendWindowCounts(collection.items,30).windowFiltered);
    expect(result.hotTopic).toBe('无日期');
    expect(result.collectedAt).toBe(collection.collectedAt);
    expect(JSON.stringify(result)).not.toContain('items');
  });
});
