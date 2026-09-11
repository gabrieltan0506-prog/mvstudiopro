/**
 * 读档终止的跨层回归（0911 复审）。验的是真实收口语义，不是「按钮点得动」：
 * · 监视独立于业务进度——没有进度回调也要能停（复审 P1 的实测反例）；
 * · 取消信号真的传到每条主路，取消不被容错分支吞成「成功」；
 * · 数据库故障不许冒充用户取消；
 * · 取消与领取、结算之间有原子边界，用户取消不重排。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isKnowledgeCardCancelledJobError,
  KnowledgeCardCancelledError,
  makeKnowledgeCardCancelWatcher,
} from "./runner";
import {
  prepareKnowledgeCardCopy,
  __setKnowledgeCardDistillGatewayInvokerForTest,
} from "../services/knowledgeCardDistill";

const SECTIONS = Array.from({ length: 6 }, (_, i) =>
  `## 第${i + 1}节\n图：示意\n- 要点\n\n| A | B |\n| - | - |\n| 1 | 2 |\n`,
).join("\n");

const stubKeys = () => {
  vi.stubEnv("EVOLINK_API_KEY", "e-key");
  vi.stubEnv("OPENROUTER_API_KEY", "o-key");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s-key");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
});

describe("取消监视独立于业务进度（复审 P1）", () => {
  it("没有任何进度回调，也能在约定时限内 abort", async () => {
    let reads = 0;
    const watcher = makeKnowledgeCardCancelWatcher("job-1", {
      pollMs: 200,
      read: async () => {
        reads += 1;
        return reads > 1; // 第一次没取消，之后取消
      },
    });
    try {
      await vi.waitFor(() => expect(watcher.signal.aborted).toBe(true), { timeout: 3_000 });
      expect(reads).toBeGreaterThan(1);
      expect(isKnowledgeCardCancelledJobError(watcher.signal.reason)).toBe(true);
    } finally {
      watcher.dispose();
    }
  }, 20_000);

  it("启动即查一次：worker 领单前就点了停，不用等第一个轮询周期", async () => {
    const watcher = makeKnowledgeCardCancelWatcher("job-2", { pollMs: 60_000, read: async () => true });
    try {
      await vi.waitFor(() => expect(watcher.signal.aborted).toBe(true), { timeout: 2_000 });
    } finally {
      watcher.dispose();
    }
  }, 20_000);

  it("慢库不堆积：同一任务最多一条查询在途", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const watcher = makeKnowledgeCardCancelWatcher("job-3", {
      pollMs: 20,
      read: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 120));
        inFlight -= 1;
        return false;
      },
    });
    try {
      await new Promise((r) => setTimeout(r, 500));
      expect(maxInFlight).toBe(1);
    } finally {
      watcher.dispose();
    }
  }, 20_000);

  it("查库抛错只记日志：不误判成取消，也不产生未处理拒绝", async () => {
    const rejections: unknown[] = [];
    const onR = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onR);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const watcher = makeKnowledgeCardCancelWatcher("job-4", {
      pollMs: 30,
      read: async () => {
        throw new Error("db down");
      },
    });
    try {
      await new Promise((r) => setTimeout(r, 250));
      expect(watcher.signal.aborted).toBe(false);
      // 业务线程上顺手查也不许把活判死
      await expect(watcher.check({ force: true })).resolves.toBeUndefined();
      expect(rejections).toEqual([]);
    } finally {
      watcher.dispose();
      process.off("unhandledRejection", onR);
    }
  }, 20_000);

  it("dispose 之后不再查库", async () => {
    let reads = 0;
    const watcher = makeKnowledgeCardCancelWatcher("job-5", {
      pollMs: 20,
      read: async () => {
        reads += 1;
        return false;
      },
    });
    await new Promise((r) => setTimeout(r, 120));
    watcher.dispose();
    const afterDispose = reads;
    await new Promise((r) => setTimeout(r, 200));
    expect(reads).toBe(afterDispose);
  }, 20_000);

  it("force 跳过轮询缓存：结算前那一次必须真查", async () => {
    let reads = 0;
    const watcher = makeKnowledgeCardCancelWatcher("job-6", {
      pollMs: 60_000,
      read: async () => {
        reads += 1;
        return reads > 1;
      },
    });
    try {
      await vi.waitFor(() => expect(reads).toBe(1), { timeout: 2_000 });
      // 不带 force：吃缓存，不查
      await watcher.check();
      expect(reads).toBe(1);
      // 带 force：真查，且这次库里已是取消
      await expect(watcher.check({ force: true })).rejects.toBeInstanceOf(KnowledgeCardCancelledError);
      expect(reads).toBe(2);
    } finally {
      watcher.dispose();
    }
  }, 20_000);
});

describe("取消真的传到主路，且不被容错吞掉（复审 P1）", () => {
  it("短文单发：abort 后立刻抛取消，不再发起新的网关请求", async () => {
    stubKeys();
    const ac = new AbortController();
    let calls = 0;
    __setKnowledgeCardDistillGatewayInvokerForTest(async (params: { abortSignal?: AbortSignal }) => {
      calls += 1;
      ac.abort(new KnowledgeCardCancelledError());
      await new Promise((r) => setTimeout(r, 10));
      params.abortSignal?.throwIfAborted();
      return SECTIONS;
    });
    await expect(
      prepareKnowledgeCardCopy({ sourceText: "正文".repeat(400), forceDistill: true, abortSignal: ac.signal }),
    ).rejects.toThrow(/停止读档/);
    expect(calls).toBe(1);
  }, 30_000);

  it("已取消的信号进入主路：一次网关请求都不发", async () => {
    stubKeys();
    const ac = new AbortController();
    ac.abort(new KnowledgeCardCancelledError());
    let calls = 0;
    __setKnowledgeCardDistillGatewayInvokerForTest(async () => {
      calls += 1;
      return SECTIONS;
    });
    await expect(
      prepareKnowledgeCardCopy({ sourceText: "正文".repeat(400), forceDistill: true, abortSignal: ac.signal }),
    ).rejects.toThrow(/停止读档|aborted/i);
    expect(calls).toBe(0);
  }, 30_000);

  it("统稿期间取消：不许「保留输入稿」冒充成功交付", async () => {
    stubKeys();
    const ac = new AbortController();
    let calls = 0;
    // 长输入 → 分段 + 统稿；统稿那一跳时用户点停
    __setKnowledgeCardDistillGatewayInvokerForTest(async (params: { abortSignal?: AbortSignal; chunkLabel?: string }) => {
      calls += 1;
      if (calls >= 3) {
        ac.abort(new KnowledgeCardCancelledError());
        params.abortSignal?.throwIfAborted();
      }
      return SECTIONS;
    });
    await expect(
      prepareKnowledgeCardCopy({ sourceText: "正文内容".repeat(9_000), forceDistill: true, abortSignal: ac.signal }),
    ).rejects.toThrow(/停止读档|aborted/i);
  }, 60_000);

  it("没有取消信号时正常路径不受影响（别把好活一起掐了）", async () => {
    stubKeys();
    __setKnowledgeCardDistillGatewayInvokerForTest(async () => SECTIONS);
    const r = await prepareKnowledgeCardCopy({ sourceText: "正文".repeat(400), forceDistill: true });
    expect(r.distilledMarkdown).toContain("## 第1节");
  }, 30_000);
});

describe("数据库故障不许冒充用户取消（复审 P2）", () => {
  it("数据库不可用：抛错交给 watcher，不当成取消", async () => {
    vi.resetModules();
    vi.doMock("../db", () => ({ getDb: async () => null }));
    const { isPlatformJobCancelRequested } = await import("./repository");
    await expect(isPlatformJobCancelRequested("job-x")).rejects.toThrow(/Database unavailable/);
    vi.doUnmock("../db");
    vi.resetModules();
  });

  it("查询抛异常：同样抛出，不当成取消", async () => {
    vi.resetModules();
    vi.doMock("../db", () => ({
      getDb: async () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => { throw new Error("query boom"); } }) }) }),
      }),
    }));
    const { isPlatformJobCancelRequested } = await import("./repository");
    await expect(isPlatformJobCancelRequested("job-y")).rejects.toThrow(/query boom/);
    vi.doUnmock("../db");
    vi.resetModules();
  });

  it("查询成功但确实没有这行：才按孤儿任务停止", async () => {
    vi.resetModules();
    vi.doMock("../db", () => ({
      getDb: async () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      }),
    }));
    const { isPlatformJobCancelRequested } = await import("./repository");
    await expect(isPlatformJobCancelRequested("job-z")).resolves.toBe(true);
    vi.doUnmock("../db");
    vi.resetModules();
  });
});
