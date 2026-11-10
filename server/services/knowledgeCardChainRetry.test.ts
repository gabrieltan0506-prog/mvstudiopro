import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS,
  KNOWLEDGE_CARD_CHAIN_RETRY_ROUNDS,
  retryKnowledgeCardChain,
} from "./knowledgeCardChainRetry";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("1013 用户令：模型服务异常隔 20 秒重试 4 次（0923 旧口径 30 秒 × 3 次已替换）", () => {
  it("口径写死：4 次、20 秒", () => {
    expect(KNOWLEDGE_CARD_CHAIN_RETRY_ROUNDS).toBe(4);
    expect(KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS).toBe(20_000);
  });

  it("前三次失败、第四次成功：拿到结果，每次之间真的等满 20 秒", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const run = vi.fn(async () => {
      n += 1;
      if (n <= 3) throw new Error("算力紧张，请稍后再试");
      return "ok";
    });
    const p = retryKnowledgeCardChain(run, { label: "t", isRetryable: () => true });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS);
    await expect(p).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("重试 4 次仍失败：才把错误交给前端，总共跑 5 遍", async () => {
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn(async () => {
      throw new Error("上游 503");
    });
    await expect(retryKnowledgeCardChain(run, { label: "t", isRetryable: () => true })).rejects.toThrow("上游 503");
    expect(run).toHaveBeenCalledTimes(1 + KNOWLEDGE_CARD_CHAIN_RETRY_ROUNDS);
  });

  it("确定性失败（额度/配置/安全拒答）不重试", async () => {
    const run = vi.fn(async () => {
      throw new Error("提炼账户额度不足");
    });
    await expect(retryKnowledgeCardChain(run, { label: "t", isRetryable: () => false })).rejects.toThrow("额度不足");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("等重试期间用户点终止：立刻收口，不再跑下一遍", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ac = new AbortController();
    const run = vi.fn(async () => {
      throw new Error("上游 503");
    });
    const p = retryKnowledgeCardChain(run, { label: "t", abortSignal: ac.signal, isRetryable: () => true });
    const settled = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    ac.abort(new Error("用户已停止读档"));
    const err = await settled;
    expect((err as Error).message).toBe("用户已停止读档");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
