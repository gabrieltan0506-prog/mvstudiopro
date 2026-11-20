import { describe, expect, it } from "vitest";
import { knowledgeParallelAfterBatch } from "./knowledgePublicationParallelState";

describe("审校批收妥后的并发状态合并", () => {
  it("多批乱序完成后 family 与通道分配仍在，completed 与连续前缀正确", () => {
    let pub = { completedBatches: 0, requestId: "r", parallel: { channels: { "0": "openrouter", "1": "evolink", "2": "evolink" } as Record<string, "openrouter" | "evolink">, completed: [] as number[], family: "glm" as const } };
    for (const i of [1, 2, 0, 4]) pub = knowledgeParallelAfterBatch(pub, i, 56).publication;
    expect(pub.parallel.family).toBe("glm");
    expect(pub.parallel.channels).toEqual({ "0": "openrouter", "1": "evolink", "2": "evolink" });
    expect(pub.parallel.completed).toEqual([0, 1, 2, 4]);
    expect(pub.completedBatches).toBe(3);
    expect(pub.requestId).toBe("r");
  });

  it("旧稿缺 family 时不补写，保持旧请求身份", () => {
    const { publication, done } = knowledgeParallelAfterBatch({ completedBatches: 2, parallel: { channels: {}, completed: [] } }, 3, 5);
    expect("family" in publication.parallel!).toBe(false);
    expect(publication.parallel!.completed).toEqual([0, 1, 3]);
    expect(done).toBe(3);
  });

  it("parallel 上将来新增的字段也原样保留", () => {
    const pub = { completedBatches: 0, parallel: { channels: {}, completed: [], family: "deepseek" as const, extra: 7 } };
    expect(knowledgeParallelAfterBatch(pub, 0, 2).publication.parallel).toMatchObject({ family: "deepseek", extra: 7, completed: [0] });
  });
});
