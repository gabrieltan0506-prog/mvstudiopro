/**
 * 模型层接线测试。
 *
 * 这个 PR 的全部意义是「把两半接上」，所以除了函数本身，
 * 还有一条**源码契约测试**锁住 `learnOneEpisodeChunk` 里真的有那道分支——
 * 本系列 PR 已经被「写完模块没人调」打回过三轮（#1298 也是为此加的契约断言）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateNativeDeepReadSignals,
  learnEpisodeChunkViaNativeDeepRead,
  type NativeDeepReadChunkDeps,
} from "./manhuaNativeDeepReadChunk";
import { isStrictManhuaLearnChunkComplete } from "../../shared/manhuaTemplateLearnSeries";

const beat = (atSec: number) => ({ atSec, conflictZh: `冲突${atSec}`, visualZh: `画面${atSec}` });

const runResult = (over: Record<string, unknown> = {}) => ({
  beatGrid: [beat(0), beat(3)],
  beatStructureZh: "憋 3 秒，第 4 秒爆，爆后 2 秒收",
  moodArcZh: "压抑→翻转→释然",
  reusableZh: "先给压迫再给反差",
  genPromptHintZh: "冷光压顶 + 面部特写",
  segmentCount: 1,
  shotCount: 2,
  failedSegmentCount: 0,
  droppedCount: 0,
  truncated: false,
  usage: { inputTokens: 100, outputTokens: 200, costCny: 0.02 },
  attemptedSegments: 1,
  usingPlanQuota: true,
  model: "qwen3.8-max",
  ...over,
});

const deps = (over: Record<string, unknown> = {}): NativeDeepReadChunkDeps =>
  ({
    run: vi.fn(async () => runResult()) as never,
    resolveNodes: vi.fn(async () => ["https://cdn/a.mp4"]) as never,
    ...over,
  }) as NativeDeepReadChunkDeps;

const input = {
  mediaSource: { url: "https://www.douyin.com/video/123" },
  startSec: 0,
  endSec: 60,
};

describe("三信号检查（质量门补在生产者这一侧）", () => {
  const base = {
    failedSegmentCount: 0,
    droppedCount: 0,
    truncated: false,
    shotCount: 2,
    segmentCount: 1,
    beatGrid: [beat(0)],
  };

  it("全绿放行，不带提示", () => {
    expect(evaluateNativeDeepReadSignals(base)).toEqual({ ok: true, noteZh: undefined });
  });

  it("有段没读成 → 拦下，且口径与旧链路一致（未计入已学）", () => {
    const r = evaluateNativeDeepReadSignals({ ...base, failedSegmentCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.reasonZh).toContain("2 段未读成");
    expect(r.reasonZh).toContain("未计入已学");
  });

  it("一个镜头都没学到 → 拦下（beatGrid 空不算成功）", () => {
    const r = evaluateNativeDeepReadSignals({ ...base, beatGrid: [], shotCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasonZh).toContain("没有产出任何镜头");
  });

  it("触顶抽稀与丢镜 → **记录但不拦**，交人在审批页判断", () => {
    const r = evaluateNativeDeepReadSignals({ ...base, truncated: true, droppedCount: 5 });
    expect(r.ok).toBe(true);
    expect(r.noteZh).toContain("触顶 128");
    expect(r.noteZh).toContain("5 个镜头");
  });
});

describe("learnEpisodeChunkViaNativeDeepRead", () => {
  it("产出映射：beatGrid 进 beatHints，节奏结构进 hookNoteZh，记真实模型名", async () => {
    const chunk = await learnEpisodeChunkViaNativeDeepRead(input, deps());
    expect(chunk.startSec).toBe(0);
    expect(chunk.endSec).toBe(60);
    expect(chunk.beatHints).toHaveLength(2);
    expect(chunk.hookNoteZh).toContain("第 4 秒爆");
    expect(chunk.vision?.model).toBe("qwen3.8-max");
    expect(chunk.vision?.provider).toBe("bailian-native-deep-read");
  });

  it("🔴 不填 audioAnalysis / denseFrames —— 填了会被严格门当场判死", async () => {
    const chunk = await learnEpisodeChunkViaNativeDeepRead(input, deps());
    expect(chunk.audioAnalysis).toBeUndefined();
    expect(chunk.denseFrames).toBeUndefined();
    // usesStrictPolicy = Boolean(audioAnalysis || denseFrames)：两者都空才不触发那道门
    expect(isStrictManhuaLearnChunkComplete(chunk)).toBe(false);
  });

  it("没有的东西不编：转写为空、climaxNotes / sceneHints 不塞占位", async () => {
    const chunk = await learnEpisodeChunkViaNativeDeepRead(input, deps());
    expect(chunk.transcriptPreview).toBe("");
    expect(chunk.climaxNotes).toEqual([]);
    expect(chunk.sceneHints).toEqual([]);
  });

  it("触顶/丢镜的提示落进 vision.errorNote，产出仍然可用", async () => {
    const chunk = await learnEpisodeChunkViaNativeDeepRead(
      input,
      deps({ run: vi.fn(async () => runResult({ truncated: true, droppedCount: 3 })) }),
    );
    expect(chunk.vision?.success).toBe(true);
    expect(chunk.vision?.errorNote).toContain("触顶 128");
  });

  it("上游抛错 → 包成「未计入已学」，与旧链路同口径", async () => {
    await expect(
      learnEpisodeChunkViaNativeDeepRead(
        input,
        deps({ run: vi.fn(async () => { throw new Error("套餐通道未配置"); }) }),
      ),
    ).rejects.toThrow(/套餐通道未配置.*未计入已学/);
  });

  it("硬失败不产出 chunk：有段没读成时抛错而不是返回半份", async () => {
    await expect(
      learnEpisodeChunkViaNativeDeepRead(
        input,
        deps({ run: vi.fn(async () => runResult({ failedSegmentCount: 1 })) }),
      ),
    ).rejects.toThrow(/未读成/);
  });

  it("区间非法直接拒，不浪费一次付费调用", async () => {
    const d = deps();
    await expect(
      learnEpisodeChunkViaNativeDeepRead({ ...input, startSec: 30, endSec: 30 }, d),
    ).rejects.toThrow(/区间非法/);
    expect(d.run).not.toHaveBeenCalled();
  });

  it("片源地址来自素材接入层：交给 runner 的解析回调用的是 mediaSource.url", async () => {
    const d = deps();
    const signal = new AbortController().signal;
    await learnEpisodeChunkViaNativeDeepRead({ ...input, abortSignal: signal }, d);

    // runner 是在需要时才调这个回调（地址约 8 分钟失效，跨段要重解析），
    // 所以断言要落在回调本身，而不是「有没有被立刻调用过」。
    const call = (d.run as unknown as { mock: { calls: Array<[{ resolveNodes: () => Promise<string[]>; segments: unknown[] }]> } }).mock.calls[0]![0];
    await call.resolveNodes();
    expect(d.resolveNodes).toHaveBeenCalledWith("https://www.douyin.com/video/123", signal);
    expect(call.segments).toEqual([{ startSec: 0, endSec: 60, hintZh: undefined }]);
  });
});

describe("源码契约：主链真的接上了（防「写完没人调」）", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "server/services/manhuaTemplateLearnService.ts"),
    "utf8",
  );

  it("learnOneEpisodeChunk 里有 flag 分支并调用精读", () => {
    expect(src).toContain("isManhuaNativeDeepReadEnabled()");
    expect(src).toContain("learnEpisodeChunkViaNativeDeepRead");
  });

  it("分支在旧模型层之前 —— 排在后面就等于永远走不到", () => {
    const branch = src.indexOf("isManhuaNativeDeepReadEnabled()");
    const oldAudio = src.indexOf("analyzeManhuaDramaAudioWithFallback({");
    expect(branch).toBeGreaterThan(-1);
    expect(oldAudio).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(oldAudio);
  });

  it("素材接入层没被动：解析剧名 / 付费边界 / cookie 轮换仍在", () => {
    // 这三样是任何学习方式都要用的基本功能，替换模型层不该碰它们
    expect(src).toContain("fetchDouyinAwemeDetailViaWebApi");
    expect(src).toContain("paywallStartEpisodeIndex");
    expect(src).toContain("extractDouyinMixIdFromUrl");
  });

  it("挑 format 的口径只有一处实现：脚本改引用 runner，不再自己写一份", () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), "scripts/manhua-native-deep-read-batch.mts"),
      "utf8",
    );
    expect(script).toContain("resolveNativeDeepReadNodeUrls");
    expect(script).not.toContain("pickSmallestVideoFormat(");
  });
});
