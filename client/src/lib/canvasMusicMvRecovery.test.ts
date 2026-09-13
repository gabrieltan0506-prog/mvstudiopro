import { describe, expect, it } from "vitest";
import {
  invalidateMusicMvPlan,
  hasPendingMusicMvPlan,
  mergeMusicCandidates,
  musicPlanInputKey,
  refreshMusicCandidate,
} from "./canvasMusicMvRecovery";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  buildLocalCloudDraftSnapshot,
  serializeCloudDraftForUpload,
  cloudDraftBlocksToCanvas,
} from "./manhuaCloudDraftSync";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import type { CanvasMusicMvState } from "@shared/canvasMusicMv";
const audio = {
  id: "song",
  url: "https://test.invalid/old",
  gcsUri: "gs://test-bucket/song.mp3",
  durationSec: 10,
};
const requestId = "00000000-0000-4000-8000-000000000001";
const referenceImages = [
  {
    id: "hero",
    fileName: "女主.png",
    url: "https://test.invalid/hero.png",
    gcsUri: "gs://test-bucket/hero.png",
  },
];
const state: CanvasMusicMvState = {
  status: "planning",
  candidates: [audio],
  selectedCandidateId: "song",
  creativePrompt: "雨夜相逢",
  referenceImages,
  planRequestId: requestId,
  planInput: {
    requestId,
    audio,
    creativePrompt: "雨夜相逢",
    lyrics: "",
    referenceSummaries: ["女主.png"],
  },
  shotBlockIds: ["old-shot"],
  assembleRequestId: requestId,
  assembleJobId: "old-job",
  finalBlockId: "old-final",
};
describe("MV 导入与分镜恢复", () => {
  it("输入快照和参考顺序随云草稿恢复，不借用已清除的上传列表", () => {
    const block = { ...defaultCanvasBlock("music", 0, 0), musicMv: state };
    const snapshot = buildLocalCloudDraftSnapshot({
      writerSession: {},
      blocks: [block],
      edges: [],
    });
    const restored = cloudDraftBlocksToCanvas(
      parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(snapshot))!
        .canvas.blocks
    )[0];
    expect(restored.uploadedAssets).toEqual([]);
    expect(restored.musicMv?.referenceImages).toEqual(referenceImages);
    expect(restored.musicMv?.planInput).toEqual(state.planInput);
  });
  it("改创意仅失效链路引用，保留歌曲与音乐任务，不修改旧状态对象", () => {
    const changed = invalidateMusicMvPlan(state);
    expect(changed.candidates).toEqual(state.candidates);
    expect(changed.planInput).toBeUndefined();
    expect(changed.shotBlockIds).toBeUndefined();
    expect(changed.assembleJobId).toBeUndefined();
    expect(state.shotBlockIds).toEqual(["old-shot"]);
  });
  it("晚回包判断排除新签名，但歌曲、时长、创意或参考顺序变化均失效", () => {
    const key = musicPlanInputKey(state, "fallback");
    expect(
      musicPlanInputKey(
        {
          ...state,
          candidates: [{ ...audio, url: "https://test.invalid/fresh" }],
        },
        "fallback"
      )
    ).toBe(key);
    expect(
      musicPlanInputKey({ ...state, creativePrompt: "新故事" }, "fallback")
    ).not.toBe(key);
    expect(
      musicPlanInputKey(
        { ...state, candidates: [{ ...audio, durationSec: 12 }] },
        "fallback"
      )
    ).not.toBe(key);
    expect(
      musicPlanInputKey({ ...state, referenceImages: [] }, "fallback")
    ).not.toBe(key);
  });
  it("保留全部历史变体，续签只替换同一身份且不重排", async () => {
    const old = Array.from({ length: 45 }, (_, i) => ({
      ...audio,
      id: `audio-${i}`,
    }));
    const fresh = await refreshMusicCandidate(old[5], async uri => {
      expect(uri).toBe(audio.gcsUri);
      return "https://test.invalid/fresh";
    });
    const merged = mergeMusicCandidates(old, [fresh]);
    expect(merged).toHaveLength(45);
    expect(merged.map(row => row.id)).toEqual(old.map(row => row.id));
    expect(merged[5].url).toBe("https://test.invalid/fresh");
    await expect(
      refreshMusicCandidate(audio, async () => {
        throw new Error("权限不足");
      })
    ).rejects.toThrow("权限不足");
    expect(audio.url).toBe("https://test.invalid/old");
  });
});

it("外层编辑与状态错误不能释放未知分镜身份，仅明确终态解锁", () => {
  expect(hasPendingMusicMvPlan(state)).toBe(true);
  expect(hasPendingMusicMvPlan({ ...state, status: "error" })).toBe(true);
  expect(
    hasPendingMusicMvPlan({ ...state, planTerminalStatus: "failed" })
  ).toBe(false);
});
