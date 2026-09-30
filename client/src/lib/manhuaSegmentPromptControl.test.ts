import { formatPromptForEngine } from "@shared/promptFormatLayer";
import { renderManhuaClipPromptForSeedance } from "@shared/manhuaClipPromptSanitize";
import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeManhuaPromptSeconds } from "@shared/manhuaPromptSeconds";
import { resolveManhuaEditedClipPrompt } from "@shared/manhuaClipPromptEdit";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { defaultCanvasBlock } from "./canvasTypes";
import { buildLocalCloudDraftSnapshot, cloudDraftBlocksToCanvas, serializeCloudDraftForUpload } from "./manhuaCloudDraftSync";
import * as execution from "./canvasRunBlock";
import { ensureManhuaFragmentClips, expandManhuaShotKeyartsAfterReverse, runManhuaDramaFactoryPipeline, spawnManhuaDramaStudio } from "./canvasDramaStudio";

afterEach(() => vi.restoreAllMocks());

it("秒位只保留一位，对白、URL与焦距数值保持原样", () => {
  const text = "4–9.015999999s：说「等1.234秒。」；焦距35.123mm\n原镜内6.215999999–23.25555秒／总长31.555秒\nhttps://test.invalid/9.123s.mp4";
  expect(formatPromptForEngine(renderManhuaClipPromptForSeedance(text), "seedance-2.5").text).toContain("{等1.234秒。}");
  expect(normalizeManhuaPromptSeconds(text)).toBe("4–9s：说「等1.234秒。」；焦距35.123mm\n原镜内6.2–23.3秒／总长31.6秒\nhttps://test.invalid/9.123s.mp4");
});

function threeSegments() {
  const spawned = spawnManhuaDramaStudio({ topic: "只跑当前段", episodeIndex: 1, videoModel: "seedance-2.0-mini" });
  const reverse = spawned.blocks.find(block => block.id.startsWith("reverse-"))!;
  const expanded = expandManhuaShotKeyartsAfterReverse(spawned.blocks.map(block => block.id === reverse.id
    ? { ...block, status: "done" as const, outputText: Array.from({ length: 9 }, (_, i) => `${i + 1}. 空房间灯光逐渐变化${i + 1}`).join("\n") } : block), spawned.edges, reverse.id, { videoModel: "seedance-2.0-mini" });
  return ensureManhuaFragmentClips(expanded.blocks.map(block => block.id.startsWith("keyart-")
    ? { ...block, status: "done" as const, outputUrl: `https://test.invalid/${block.id}.png`, manhuaKeyartLookState: recordManhuaKeyartLookOutput(block, `https://test.invalid/${block.id}.png`), manhuaKeyartSourceState: recordManhuaKeyartLookOutput({ manhuaKeyartLookState: block.manhuaKeyartSourceState }, `https://test.invalid/${block.id}.png`) } : block), expanded.edges, 1, { videoModel: "seedance-2.0-mini" });
}

it("编辑全文和保留状态穿过云存储、恢复及重新铺段，其他段与音轨不变", () => {
  const seeded = threeSegments();
  const clips = seeded.blocks.filter(block => block.id.startsWith("clip-") && block.manhuaAutoSegment);
  expect(clips.length).toBeGreaterThanOrEqual(3);
  const target = clips[2]!;
  const text = "【第3段·15s】\n0–9.01599999s：人物停下，随后回头；说「你在哪里？」\n9.01599999–15s：留下悬念。";
  const changed = seeded.blocks.map(block => block.id === target.id ? { ...block, manhuaGenerationHold: true, prompt: text,
    manhuaPromptEdit: { text, sourceRevision: block.manhuaAutoSegment!.revision } } : block);
  const snapshot = buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: changed, edges: seeded.edges });
  const restored = cloudDraftBlocksToCanvas(parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(snapshot))!.canvas.blocks);
  const laid = ensureManhuaFragmentClips(restored, seeded.edges, 1, { videoModel: "seedance-2.0-mini" });
  const actual = laid.blocks.find(block => block.id === target.id)!;
  expect(actual.manhuaGenerationHold).toBe(true);
  expect(actual.prompt).toBe(normalizeManhuaPromptSeconds(text));
  expect(actual.manhuaPromptEdit?.text).toBe(actual.prompt);
  expect(laid.blocks.find(block => block.id === clips[1]!.id)?.prompt).toBe(clips[1]!.prompt);
  expect(actual.audioStudio).toEqual(target.audioStudio);
  expect(() => resolveManhuaEditedClipPrompt("系统稿", actual.manhuaPromptEdit, "changed-source")).toThrow("原稿分段已变化");
});

it("用户点击第一段后失败只执行一次，不自动发第二/第三段或重试", async () => {
  const seeded = threeSegments();
  const clips = seeded.blocks.filter(block => block.id.startsWith("clip-") && block.manhuaAutoSegment);
  const first = clips[0]!;
  const run = vi.spyOn(execution, "runCanvasBlock").mockRejectedValue(new Error("第一段动作不合格，先修输入"));
  const result = await runManhuaDramaFactoryPipeline({
    deps: { optimizeCopy: async () => "" }, blocks: seeded.blocks, edges: seeded.edges,
    episodeIndex: 1, untilStage: "clip", forceFromStage: "clip", fragmentShotIndex: 1,
    targetBlockIds: [first.id], maxRetries: 0, stopOnError: true,
    ensureOptions: { videoModel: "seedance-2.0-mini" },
  });
  expect(result.errors.map(error => error.message)).toEqual(["第一段动作不合格，先修输入"]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]![1].id).toBe(first.id);
  expect(result.errors).toHaveLength(1);
  expect(result.completedIds).toEqual([]);
  for (const block of clips.slice(1)) expect(result.blocks.find(item => item.id === block.id)).toEqual(block);
});

it("保留段在执行器进入任何网络/任务之前拒绝", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止真实网络"));
  const block = { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g02", manhuaGenerationHold: true };
  await expect(execution.runCanvasBlock({ optimizeCopy: async () => "" }, block)).rejects.toThrow("本段已设为保留");
  expect(network).not.toHaveBeenCalled();
});
