import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  buildManhuaNativeAudioPrompt,
  collectManhuaNativeAudioEvidence,
  finalizeManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioEvidenceDeps,
  type ManhuaNativeAudioModelReceipt,
} from "./manhuaNativeAudioDeepRead";

const analysis = {
  audioTrack: [{
    fromSec: 0,
    toSec: 10,
    emotionArcZh: "平稳到增强",
    toneZh: "克制后加重",
    sfxZh: "",
    bgmZh: "低频铺底",
    atmosphereZh: "压迫",
    silenceZh: "",
    cues: [],
  }],
  audioBeatStructureZh: "前段克制，末段增强",
  mixNotesZh: "人声居中",
  reusableAudioZh: "先压低背景再抬人声",
  genAudioHintZh: "保留动态层次",
};

function deps(): ManhuaNativeAudioEvidenceDeps {
  return {
    hasAudio: vi.fn(async () => true),
    extract: vi.fn(async ({ outputPath }) => { await writeFile(outputPath, "fixture"); }),
    probeLocalDuration: vi.fn(async () => 10),
    upload: vi.fn(async ({ objectName }) => ({
      bucket: "bucket-a",
      objectName,
      gcsUri: `gs://bucket-a/${objectName}`,
    })) as never,
    remove: vi.fn(async () => undefined),
    analyzeChunk: vi.fn(async () => ({
      analysis,
      inputTokens: 20,
      audioInputTokens: 12,
      outputTokens: 5,
    })) as never,
  };
}

describe("原生精读双音轨模型回执", () => {
  it("单声道与立体声各自回传 started/completed，不合并成一条总状态", async () => {
    const receipts: ManhuaNativeAudioModelReceipt[] = [];
    const result = await collectManhuaNativeAudioEvidence({
      durationSec: 10,
      resolveNodes: async () => [{ url: "https://cdn.example/video.mp4" }],
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, deps());

    expect(result.hasAudio).toBe(true);
    expect(result.usage.geminiCalls).toBe(2);
    expect(receipts.map((receipt) => `${receipt.variant}:${receipt.status}`).sort()).toEqual([
      "mono_16k:completed",
      "mono_16k:started",
      "stereo_32k:completed",
      "stereo_32k:started",
    ]);
    expect(receipts.filter((receipt) => receipt.status === "completed").every((receipt) =>
      receipt.inputTokens === 20 && receipt.audioInputTokens === 12 && receipt.outputTokens === 5,
    )).toBe(true);
  });

  it("一路失败仍等待另一路回执，并把已发生的 usage 挂到错误上", async () => {
    let releaseStereo!: () => void;
    const stereoGate = new Promise<void>((resolve) => { releaseStereo = resolve; });
    let stereoFinished = false;
    const receipts: ManhuaNativeAudioModelReceipt[] = [];
    const testDeps = deps();
    testDeps.analyzeChunk = vi.fn(async ({ gcsUri }) => {
      if (gcsUri.includes("mono_16k")) throw new Error("mono failed");
      await stereoGate;
      stereoFinished = true;
      return { analysis, inputTokens: 30, audioInputTokens: 18, outputTokens: 7 };
    }) as never;

    const pending = collectManhuaNativeAudioEvidence({
      durationSec: 10,
      resolveNodes: async () => [{ url: "https://cdn.example/video.mp4" }],
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, testDeps);
    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => undefined);

    await vi.waitFor(() => expect(testDeps.analyzeChunk).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    releaseStereo();
    let error: Error & { nativeAudioUsage?: Record<string, unknown> };
    try {
      await pending;
      throw new Error("预期单声道失败会拒绝整段声音证据");
    } catch (caught) {
      error = caught as typeof error;
    }

    expect(stereoFinished).toBe(true);
    expect(error.message).toBe("mono failed");
    expect(error.nativeAudioUsage).toMatchObject({
      inputTokens: 30,
      audioInputTokens: 18,
      outputTokens: 7,
      geminiInputTokens: 30,
      geminiAudioInputTokens: 18,
      geminiOutputTokens: 7,
      geminiCalls: 1,
      receiptComplete: false,
    });
    expect(Number(error.nativeAudioUsage?.costCny)).toBeGreaterThan(0);
    expect(receipts.map((receipt) => `${receipt.variant}:${receipt.status}`).sort()).toEqual([
      "mono_16k:failed",
      "mono_16k:started",
      "stereo_32k:completed",
      "stereo_32k:started",
    ]);
    // 网络类失败不触发门禁重试：双路各只调一次
    expect(testDeps.analyzeChunk).toHaveBeenCalledTimes(2);
  });

  it("门禁类失败整对重试一次并携带被拒原因，第二轮成功后照常入证据", async () => {
    const receipts: ManhuaNativeAudioModelReceipt[] = [];
    const calls: Array<{ variant: string; rejectedReasonZh?: string }> = [];
    const testDeps = deps();
    testDeps.analyzeChunk = vi.fn(async ({ gcsUri, rejectedReasonZh }: {
      gcsUri: string;
      rejectedReasonZh?: string;
    }) => {
      calls.push({ variant: gcsUri.includes("mono_16k") ? "mono" : "stereo", rejectedReasonZh });
      if (!rejectedReasonZh && gcsUri.includes("mono_16k")) {
        throw new Error("音频分析时间轴存在未解释空洞");
      }
      return { analysis, inputTokens: 20, audioInputTokens: 12, outputTokens: 5 };
    }) as never;

    const result = await collectManhuaNativeAudioEvidence({
      durationSec: 10,
      resolveNodes: async () => [{ url: "https://cdn.example/video.mp4" }],
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, testDeps);

    expect(testDeps.analyzeChunk).toHaveBeenCalledTimes(4);
    expect(calls.slice(0, 2).every((row) => row.rejectedReasonZh === undefined)).toBe(true);
    expect(calls.slice(2).map((row) => row.rejectedReasonZh)).toEqual([
      "音频分析时间轴存在未解释空洞",
      "音频分析时间轴存在未解释空洞",
    ]);
    // 重试轮回执与正常轮同构：4 started、1 failed、3 completed
    expect(receipts.filter((row) => row.status === "started")).toHaveLength(4);
    expect(receipts.filter((row) => row.status === "failed")).toHaveLength(1);
    expect(receipts.filter((row) => row.status === "completed")).toHaveLength(3);
    // 已付费成功调用诚实累计：第一轮立体声 + 第二轮双路
    expect(result.usage.geminiCalls).toBe(3);
    expect(result.usage.inputTokens).toBe(60);
    expect(result.chunks).toHaveLength(1);
  });

  it("门禁类失败第二轮仍未过则照常失败，不做第三次", async () => {
    const testDeps = deps();
    testDeps.analyzeChunk = vi.fn(async () => {
      throw new Error("音频分析未覆盖片段结尾");
    }) as never;

    await expect(collectManhuaNativeAudioEvidence({
      durationSec: 10,
      resolveNodes: async () => [{ url: "https://cdn.example/video.mp4" }],
    }, testDeps)).rejects.toThrow("音频分析未覆盖片段结尾");
    expect(testDeps.analyzeChunk).toHaveBeenCalledTimes(4);
  });

  it("重试提示词追加【上一轮被拒原因】，正常提示词不带", () => {
    const chunk = { index: 0, startSec: 0, endSec: 10 };
    const prompt = buildManhuaNativeAudioPrompt(chunk, "音频分析未覆盖片段结尾");
    expect(prompt).toContain("【上一轮被拒原因】音频分析未覆盖片段结尾。请修正后重新输出完整 JSON。");
    expect(prompt).toContain("01:23-01:40");
    expect(buildManhuaNativeAudioPrompt(chunk)).not.toContain("上一轮被拒原因");
  });

  it("按 chunkIndex 配对而非数组位置，置换顺序仍落到正确绝对秒", async () => {
    const evidence = {
      hasAudio: true,
      durationSec: 20,
      chunks: [
        { chunk: { index: 0, startSec: 0, endSec: 10 }, mono16k: analysis, stereo32k: analysis },
        { chunk: { index: 1, startSec: 10, endSec: 20 }, mono16k: analysis, stereo32k: analysis },
      ],
      usage: {
        inputTokens: 40, audioInputTokens: 24, outputTokens: 10, costCny: 0.1,
        receiptComplete: true, geminiInputTokens: 40, geminiAudioInputTokens: 24,
        geminiOutputTokens: 10, geminiCostCny: 0.1, geminiCalls: 4,
      },
    };
    const result = await finalizeManhuaNativeAudioAnalysis({
      evidence,
      singaporeResolvedChunks: [
        { chunkIndex: 1, analysis: { ...analysis, audioBeatStructureZh: "第二段" } },
        { chunkIndex: 0, analysis: { ...analysis, audioBeatStructureZh: "第一段" } },
      ],
    });
    expect(result.audioTrack.map((row) => [row.fromSec, row.toSec])).toEqual([[0, 10], [10, 20]]);
    expect(result.audioBeatStructureZh).toBe("第一段；第二段");
  });

  it("chunkIndex 缺失或重复时关闭式拒收", async () => {
    const evidence = {
      hasAudio: true,
      durationSec: 20,
      chunks: [
        { chunk: { index: 0, startSec: 0, endSec: 10 }, mono16k: analysis, stereo32k: analysis },
        { chunk: { index: 1, startSec: 10, endSec: 20 }, mono16k: analysis, stereo32k: analysis },
      ],
      usage: {
        inputTokens: 40, audioInputTokens: 24, outputTokens: 10, costCny: 0.1,
        receiptComplete: true, geminiInputTokens: 40, geminiAudioInputTokens: 24,
        geminiOutputTokens: 10, geminiCostCny: 0.1, geminiCalls: 4,
      },
    };
    await expect(finalizeManhuaNativeAudioAnalysis({
      evidence,
      singaporeResolvedChunks: [{ chunkIndex: 0, analysis }],
    })).rejects.toThrow("未返回完整");
    await expect(finalizeManhuaNativeAudioAnalysis({
      evidence,
      singaporeResolvedChunks: [
        { chunkIndex: 0, analysis },
        { chunkIndex: 0, analysis },
      ],
    })).rejects.toThrow("重复返回");
  });
});
