/**
 * 学习链 provenance（2026-08-10 第三轮复审必须修13）：
 * 读帧与润色分开记账、chunk→digest 聚合、提案卡 parse 不剥 provenance。
 */
import { describe, expect, it } from "vitest";
import {
  mergeManhuaLearnChunkIntoDigest,
  type ManhuaLearnEpisodeChunk,
} from "./manhuaTemplateLearnSeries";
import { parseManhuaViralTemplateCard } from "./manhuaViralTemplateBank";

function chunk(
  startSec: number,
  vision?: ManhuaLearnEpisodeChunk["vision"],
): ManhuaLearnEpisodeChunk {
  return {
    startSec,
    endSec: startSec + 600,
    transcriptPreview: "片段",
    hookNoteZh: "钩子",
    beatHints: [{ atSec: startSec, conflictZh: "冲突", visualZh: "画面" }],
    climaxNotes: [],
    sceneHints: [],
    learnedAt: new Date().toISOString(),
    vision,
  };
}

describe("digest frameVision 聚合", () => {
  it("attempted/success 按块计数，读帧失败不算成功", () => {
    let d = mergeManhuaLearnChunkIntoDigest({
      prev: null,
      chunk: chunk(0, {
        provider: "anthropic",
        model: "m1",
        attempted: true,
        success: false,
        errorNote: "boom",
      }),
      episodeIndex: 1,
      url: "https://example.com/1",
      title: "第1集",
      durationSec: 1800,
    });
    d = mergeManhuaLearnChunkIntoDigest({
      prev: d,
      chunk: chunk(600, { provider: "anthropic", model: "m2", attempted: true, success: true }),
      episodeIndex: 1,
      url: "https://example.com/1",
      title: "第1集",
      durationSec: 1800,
    });
    expect(d.frameVision).toEqual({
      provider: "anthropic",
      model: "m2",
      attemptedChunks: 2,
      successChunks: 1,
    });
  });

  it("无任何真实尝试时不伪造 frameVision", () => {
    const d = mergeManhuaLearnChunkIntoDigest({
      prev: null,
      chunk: chunk(0, undefined),
      episodeIndex: 1,
      url: "https://example.com/1",
      title: "第1集",
      durationSec: 1800,
    });
    expect(d.frameVision).toBeUndefined();
  });
});

describe("提案卡 provenance parse 保留", () => {
  const base = {
    id: "tpl_series_abc",
    nameZh: "测试模板",
    laneZh: "古言种田",
    summaryZh: "s",
    hook3sZh: "h",
    beatGrid: [{ atSec: 0, conflictZh: "冲", visualZh: "画" }],
    scenePoolHints: [],
    castShape: { leadDesireZh: "a", pressureZh: "b" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [{ url: "https://example.com", fetchedAt: "2026-08-10" }],
    status: "proposed" as const,
  };

  it("parse 后 provenance 原样可读（快照/no-batch/UI 同源消费的前提）", () => {
    const parsed = parseManhuaViralTemplateCard({
      ...base,
      provenance: {
        frameVision: { provider: "openai", model: "gpt-x", attemptedChunks: 3, successChunks: 3 },
        proposalPolish: { provider: "openai", model: "gpt-x", attempted: true, success: true },
      },
    });
    expect(parsed?.provenance?.frameVision?.successChunks).toBe(3);
    expect(parsed?.provenance?.proposalPolish?.success).toBe(true);
    expect(parsed?.provenance?.proposalPolish?.degraded).toBeUndefined();
  });

  it("润色降级标记（degraded）不会被 parse 洗掉", () => {
    const parsed = parseManhuaViralTemplateCard({
      ...base,
      provenance: {
        proposalPolish: { provider: "anthropic", model: "", attempted: true, success: false, degraded: true },
      },
    });
    expect(parsed?.provenance?.proposalPolish?.success).toBe(false);
    expect(parsed?.provenance?.proposalPolish?.degraded).toBe(true);
  });

  it("无 provenance 的旧卡 parse 后仍无 provenance（不冒充）", () => {
    const parsed = parseManhuaViralTemplateCard(base);
    expect(parsed?.provenance).toBeUndefined();
  });
});
