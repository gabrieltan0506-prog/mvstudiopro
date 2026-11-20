import { describe, expect, it } from "vitest";
import { knowledgeBookLayoutProgressFromNames, loadKnowledgeBookLayoutProgress } from "./knowledgeBookLayoutProgress";

const prefix = "knowledge-publications/user-7/doc/conversation/req";

describe("整册排版分组进度（只读清点）", () => {
  it("只数本次请求目录下已落盘的分组结果；路由回执、输入、越界编号与别的请求不计", () => {
    const names = [
      `${prefix}/batches.json`,
      `${prefix}/batch-0/input.json`, `${prefix}/batch-0/raw.json`, `${prefix}/batch-0/report.json`,
      `${prefix}/batch-1/route-evolink-glm.json`,
      `${prefix}/batch-2/report.json`,
      `${prefix}/batch-11/report.json`,
      `${prefix}/batch-12/report.json`,
      `${prefix}-other/batch-3/report.json`,
      `knowledge-publications/user-7/doc/conversation/req2/batch-4/report.json`,
    ];
    expect(knowledgeBookLayoutProgressFromNames(prefix, 12, names)).toEqual({ total: 12, done: 3, finished: false });
  });
  it("整册结果已落盘即全部完成（恢复链复用旧分组结果时本目录未必有全部分组）", () => {
    expect(knowledgeBookLayoutProgressFromNames(prefix, 12, [`${prefix}/batch-0/report.json`, `${prefix}/report.json`])).toEqual({ total: 12, done: 12, finished: true });
  });
  it("尚未分组时不列举、返回 0/0；已分组时读分组计划得到总数", async () => {
    let listed = 0;
    const none = await loadKnowledgeBookLayoutProgress(7, "doc", "req", { read: async () => null, list: async () => { listed++; return []; } });
    expect(none).toEqual({ total: 0, done: 0, finished: false });
    expect(listed).toBe(0);
    const some = await loadKnowledgeBookLayoutProgress(7, "doc", "req", {
      read: async name => name === `${prefix}/batches.json` ? { fingerprint: "f", batches: Array.from({ length: 12 }, (_, index) => ({ index, pageIds: [] })) } : null,
      list: async asked => { expect(asked).toBe(prefix); return [`${prefix}/batch-5/report.json`, `${prefix}/batch-6/report.json`]; },
    });
    expect(some).toEqual({ total: 12, done: 2, finished: false });
  });
});
