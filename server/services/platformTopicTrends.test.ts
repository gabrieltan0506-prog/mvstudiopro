import { afterEach, expect, it, vi } from "vitest";
import { buildRecentTopicEvidence, filterTrendRowsToWindow } from "./platformTopicTrends";
afterEach(()=>vi.useRealTimers());
it("严格7/15天不退回旧库，不用记录时间冒充发布时间，来源与互动必须可核对",()=>{
 vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
 const rows=[
  {id:"fresh",title:"会议沟通",publishedAt:"2026-10-29",url:"https://example.com/fresh",likes:0},
  {id:"ten",title:"会议沟通",publishedAt:"2026-10-20",url:"https://example.com/ten",comments:5},
  {id:"old",title:"会议沟通",publishedAt:"2026-10-01",url:"https://example.com/old",likes:9000},
  {id:"unknown",title:"会议沟通",observedAt:"2026-10-29",url:"https://example.com/unknown",likes:9000},
  {id:"future",title:"会议沟通",publishedAt:"2026-11-01",url:"https://example.com/future",likes:5},
  {id:"no-link",title:"会议沟通",publishedAt:"2026-10-29",likes:5},
  {id:"no-metric",title:"会议沟通",publishedAt:"2026-10-29",url:"https://example.com/no-metric"},
 ];
 expect(buildRecentTopicEvidence(rows,7,"会议沟通","xiaohongshu").samples.map(s=>s.id)).toEqual(["fresh"]);
 expect(buildRecentTopicEvidence(rows,15,"会议沟通","douyin").samples.map(s=>s.id).sort()).toEqual(["fresh","ten"]);
 expect(filterTrendRowsToWindow([rows[2],rows[3],rows[4]],7)).toEqual([]);
});
