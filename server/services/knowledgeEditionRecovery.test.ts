/** 原地重试：瞬态分类、抖动、JSON 截断重读上限、listKeys 外层重试；重排次数语义不变。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { editionCheckpointRequeueDelay, guardKnowledgeEditionEvidence, isTransientEditionCheckpointError, KnowledgeEditionPersistenceError } from "./knowledgeEditionRecovery";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function drive<T>(promise: Promise<T>) {
  const settled = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  return settled as Promise<{ value?: T; error?: unknown }>;
}

const store = () => {
  const data = new Map<string, unknown>();
  let writes = 0;
  return { data, writes: () => writes, evidence: { prefix: "p", read: async (k: string) => data.get(k) ?? null, save: async (k: string, v: unknown) => { writes += 1; data.set(k, v); } } };
};

describe("guardKnowledgeEditionEvidence", () => {
  it("连续 4 次 fetch failed 后成功：读到正确结果；写入只落一次", async () => {
    vi.useFakeTimers();
    const s = store();
    let reads = 0, saves = 0;
    const guarded = guardKnowledgeEditionEvidence({ ...s.evidence,
      read: async k => { if (++reads <= 4) throw new TypeError("fetch failed"); return s.evidence.read(k); },
      save: async (k, v) => { if (++saves <= 4) throw new TypeError("fetch failed"); return s.evidence.save(k, v); },
    });
    expect((await drive(guarded.save("a", { v: 1 }))).error).toBeUndefined();
    expect(s.writes()).toBe(1);
    expect((await drive(guarded.read("a"))).value).toEqual({ v: 1 });
    expect(reads).toBe(5);
  });

  it("terminated / ECONNRESET / socket hang up / 超时 / 令牌接口瞬态失败都按瞬态重试", async () => {
    vi.useFakeTimers();
    const econnreset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const faults: unknown[] = [
      new TypeError("terminated"),
      new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }),
      econnreset,
      new Error("socket hang up"),
      new Error("gcs_download_failed:network:timeout_60000ms"),
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      new Error("vertex_token_failed:503:{}"),
      new Error("vertex_token_failed:network:TypeError:fetch failed"),
    ];
    for (const fault of faults) {
      let n = 0;
      const guarded = guardKnowledgeEditionEvidence({ prefix: "p", save: async () => undefined, read: async () => { if (++n === 1) throw fault; return "ok"; } });
      expect((await drive(guarded.read("k"))).value).toBe("ok");
      expect(n).toBe(2);
    }
  });

  it("非瞬态错误（4xx、令牌被拒）立即失败，不重试", async () => {
    for (const fault of [new Error("gcs_download_failed:403:x"), new Error("vertex_token_failed:400:{}")]) {
      let n = 0;
      const guarded = guardKnowledgeEditionEvidence({ prefix: "p", save: async () => undefined, read: async () => { n++; throw fault; } });
      const error = await guarded.read("k").catch(e => e);
      expect(error).toBeInstanceOf(KnowledgeEditionPersistenceError);
      expect(isTransientEditionCheckpointError(error)).toBe(false);
      expect(n).toBe(1);
    }
  });

  it("JSON 截断后重读成功；三次都坏按原样失败（最多重读 2 次），不吞真损坏", async () => {
    vi.useFakeTimers();
    let n = 0;
    const flaky = guardKnowledgeEditionEvidence({ prefix: "p", save: async () => undefined,
      read: async () => JSON.parse(++n === 1 ? '{"pages":[{"body":"截' : '{"ok":true}') });
    expect((await drive(flaky.read("k"))).value).toEqual({ ok: true });
    expect(n).toBe(2);
    let m = 0;
    const broken = guardKnowledgeEditionEvidence({ prefix: "p", save: async () => undefined, read: async () => { m++; return JSON.parse("{坏"); } });
    const { error } = await drive(broken.read("k"));
    expect(error).toBeInstanceOf(KnowledgeEditionPersistenceError);
    expect((error as KnowledgeEditionPersistenceError).cause).toBeInstanceOf(SyntaxError);
    expect(isTransientEditionCheckpointError(error)).toBe(false);
    expect(m).toBe(3);
  });

  it("重试间隔带 ±20% 抖动，总窗口约 5–6 分钟", async () => {
    vi.useFakeTimers();
    for (const [r, total] of [[0, 282_400], [0.999999, 423_600]] as const) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const start = Date.now();
      const times: number[] = [];
      const guarded = guardKnowledgeEditionEvidence({ prefix: "p", save: async () => undefined, read: async () => { times.push(Date.now() - start); throw new TypeError("fetch failed"); } });
      const { error } = await drive(guarded.read("k"));
      expect(isTransientEditionCheckpointError(error)).toBe(true);
      expect(times).toHaveLength(8);
      expect(times[7]).toBe(total);
    }
  });

  it("listKeys 外层重试：瞬态失败后整次列举重来", async () => {
    vi.useFakeTimers();
    let n = 0;
    const guarded = guardKnowledgeEditionEvidence({ prefix: "p", read: async () => null, save: async () => undefined,
      listKeys: async () => { if (++n <= 2) throw new Error("gcs_list_failed:network:fetch failed（已重试 3 次）"); return ["a", "b"]; } });
    expect((await drive(guarded.listKeys!("p/"))).value).toEqual(["a", "b"]);
    expect(n).toBe(3);
  });

  it("runner 按尝试次数重排的次数语义不变（仍是 4 次）", () => {
    expect([1, 2, 3, 4, 5].map(editionCheckpointRequeueDelay)).toEqual([3000, 5000, 15000, 30000, undefined]);
  });
});
