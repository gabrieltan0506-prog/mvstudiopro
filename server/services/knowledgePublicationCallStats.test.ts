import { describe, expect, it } from "vitest";
import { knowledgePublicationCallStatsFromNames, loadKnowledgePublicationCallStats } from "./knowledgePublicationCallStats";

const P = "knowledge-publications/user-7/doc";
const R = "b051ed5f-9cc3-4137-a9a4-d2f719e2ff57", L = "0016bee5-0105-45e6-8ee7-bbe0f46b9d0a";

describe("手册稿模型请求清点（只数回执对象名）", () => {
  it("按步骤归类；只数 route-*.json，输入、原始回包、报告不计；别的稿不计", () => {
    const names = [
      `${P}/${R}/batch-0/route-a.json`, `${P}/${R}/batch-0/route-b.json`, `${P}/${R}/batch-0/report.json`, `${P}/${R}/batch-0/raw-0.json`,
      `${P}/${R}/batch-1/route-a.json`,
      `${P}/${R}/batch-1/compress-0/route-a.json`, `${P}/${R}/batch-1/research/route-b.json`,
      `${P}/${R}/consistency-0/route-a.json`, `${P}/${R}/consistency-0/route-b.json`, `${P}/${R}/consistency-plan.json`,
      `${P}/${R}/final-compress/round-0/group-0/route-a.json`, `${P}/${R}/final-compress/round-0/group-1/route-a.json`,
      `${P}/conversation/${L}/batches.json`, `${P}/conversation/${L}/batch-0/route-a.json`, `${P}/conversation/${L}/batch-1/route-b.json`, `${P}/conversation/${L}/batch-1/interrupted-repurchase.json`,
      `${P}/conversation/${R}/route-a.json`,
      `${P}/exports/abc/manifest.json`,
      `${P}2/${R}/batch-0/route-a.json`,
    ];
    const stats = knowledgePublicationCallStatsFromNames(P, names);
    expect(stats.total).toBe(12);
    expect(stats.interruptedRepurchases).toBe(1);
    expect(stats.byRoute).toEqual({ a: 8, b: 4 });
    expect(stats.stages.map(s => [s.stage, s.requests, s.units])).toEqual([
      ["review", 3, 2], ["review_followup", 2, 2], ["consistency", 2, 1], ["final_compress", 2, 2], ["layout", 2, 2], ["conversation", 1, 1],
    ]);
    expect(stats.stages[0]!.label).toBe("逐章整理");
  });
  it("没有任何回执时为 0；清点范围限定在本人本稿目录", async () => {
    let asked = "";
    const stats = await loadKnowledgePublicationCallStats(7, "doc", async prefix => { asked = prefix; return []; });
    expect(asked).toBe(P);
    expect(stats).toEqual({ total: 0, stages: [], byRoute: {}, interruptedRepurchases: 0 });
  });
});
