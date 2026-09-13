import { describe, expect, it } from "vitest";
import {
  defaultCanvasBlock,
  normalizeCanvasBlock,
  collectVisionImages,
  collectDocumentAssets,
  resolveNearestUpstreamImageUrl,
  resolveBlockHandoffText,
} from "./canvasTypes";
import {
  buildLocalCloudDraftSnapshot,
  serializeCloudDraftForUpload,
  cloudDraftBlocksToCanvas,
  slimBlocksForLocalPersist,
  trySaveLocalCanvas,
} from "./manhuaCloudDraftSync";
import {
  parseManhuaCloudDraftPayload,
  sanitizeManhuaCloudDraftBlock,
} from "@shared/manhuaCloudDraft";
import type { CanvasMusicMvState } from "@shared/canvasMusicMv";

function source() {
  const candidates = Array.from({ length: 40 }, (_, i) => ({
    id: `song-${i}`,
    url: `https://test.invalid/song-${i}.mp3?signature=old`,
    durationSec: 20,
    gcsUri: `gs://test-bucket/audio/song-${i}.mp3`,
  }));
  const musicMv: CanvasMusicMvState = {
    status: "planned",
    candidates,
    selectedCandidateId: "song-0",
    musicJobId: "original-music-task",
    musicRequestId: "00000000-0000-4000-8000-000000000001",
    assembleJobId: "original-assemble-job",
    shotBlockIds: ["mv-shot-1", "mv-shot-2"],
    finalBlockId: "mv-final",
    plan: {
      version: 1,
      audioId: "song-0",
      audioDurationSec: 20,
      analysisBasis: "lyrics_and_user_description",
      shots: [
        {
          id: "shot-1",
          startSec: 0,
          endSec: 10,
          visualPrompt: "雨夜街道",
          cameraPrompt: "缓慢推进",
          lyricQuote: "",
          referenceIndices: [],
        },
        {
          id: "shot-2",
          startSec: 10,
          endSec: 20,
          visualPrompt: "天色渐亮",
          cameraPrompt: "抬升",
          lyricQuote: "",
          referenceIndices: [],
        },
      ],
    },
  };
  return {
    ...defaultCanvasBlock("music", 0, 0),
    id: "music-source",
    status: "done" as const,
    outputText: "整首歌曲与 MV 分镜",
    musicMv,
    outputUrl: candidates[0].url,
    outputUrls: candidates.map(item => item.url),
  };
}

describe("音乐节点持久化与媒体交接", () => {
  it("本地、配额降级、云端和恢复保留全部旧音频及原任务和完整镜头", () => {
    const original = source();
    const slim = slimBlocksForLocalPersist([original]);
    expect(slim[0].outputUrls).toHaveLength(40);
    let attempts = 0;
    let stored = "";
    expect(
      trySaveLocalCanvas([original], [], {
        setItem(_key, value) {
          if (++attempts === 1) throw new Error("QuotaExceededError");
          stored = value;
        },
      })
    ).toBe(true);
    expect(JSON.parse(stored).blocks[0].outputUrls).toEqual(
      original.outputUrls
    );
    const snapshot = buildLocalCloudDraftSnapshot({
      writerSession: {},
      blocks: slim,
      edges: [],
    });
    const parsed = parseManhuaCloudDraftPayload(
      serializeCloudDraftForUpload(snapshot)
    );
    expect(parsed).not.toBeNull();
    const [restored] = cloudDraftBlocksToCanvas(parsed!.canvas.blocks);
    expect(restored.kind).toBe("music");
    expect(restored.musicMv).toEqual(original.musicMv);
    expect(restored.outputUrls).toEqual(original.outputUrls);
    expect(restored.outputText).toBe(original.outputText);
    expect(resolveBlockHandoffText(restored)).toContain("实际时长 20 秒");
    expect(resolveBlockHandoffText(restored)).toContain("shot-2");
  });

  it("拒绝损坏的歌曲选择，不静默丢弃原状态", () => {
    const broken = {
      ...source(),
      musicMv: { ...source().musicMv, selectedCandidateId: "missing" },
    };
    expect(() => normalizeCanvasBlock(broken)).toThrow();
    expect(() => sanitizeManhuaCloudDraftBlock(broken)).toThrow();
  });

  it("旧草稿无 musicMv 仍正常恢复，失败状态保留旧音频", () => {
    expect(
      normalizeCanvasBlock(defaultCanvasBlock("image", 0, 0)).musicMv
    ).toBeUndefined();
    const failed = sanitizeManhuaCloudDraftBlock({
      ...source(),
      status: "error",
      error: "本次失败",
    });
    expect(failed?.status).toBe("error");
    expect(failed?.error).toBe("本次失败");
    expect(failed?.outputUrls).toHaveLength(40);
  });

  it("无扩展名的音乐输出不能进入图片引用，仍可穿过音乐节点寻找真正上游图片", () => {
    const music = {
      ...source(),
      outputUrl: "https://test.invalid/opaque-audio",
      outputUrls: ["https://test.invalid/opaque-audio"],
    };
    const image = {
      ...defaultCanvasBlock("image", 0, 0),
      id: "image-source",
      outputUrl: "https://test.invalid/image.png",
    };
    const video = { ...defaultCanvasBlock("video", 0, 0), id: "video-target" };
    const blocks = [image, music, video];
    const edges = [
      { fromId: image.id, toId: music.id },
      { fromId: music.id, toId: video.id },
    ];
    expect(collectVisionImages(video.id, blocks, edges)).toEqual([
      { url: image.outputUrl },
    ]);
    expect(resolveNearestUpstreamImageUrl(video.id, blocks, edges)).toBe(
      image.outputUrl
    );
    music.uploadedAssets = [
      {
        id: "audio",
        kind: "audio",
        previewUrl: "https://test.invalid/lyrics.txt",
        url: "https://test.invalid/lyrics.txt",
        fileName: "lyrics.txt",
        mimeType: "text/plain",
      },
    ];
    expect(collectDocumentAssets(video.id, blocks, edges)).toEqual([]);
  });
});
