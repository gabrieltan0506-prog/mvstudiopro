import { describe, expect, it } from "vitest";
import {
  invalidateMusicMvPlan,
  captureMusicCandidateContexts,
  selectMusicCandidateContext,
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
import {
  canvasMusicMvStateSchema,
  type CanvasMusicMvState,
} from "@shared/canvasMusicMv";
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

describe("歌曲候选创作内容绑定", () => {
  it("切换旧歌恢复自己歌词，新一轮内容不覆盖旧歌", () => {
    const state: CanvasMusicMvState = {
      status: "music_ready",
      candidates: [],
      selectedCandidateId: "old",
      lyrics: "新一轮歌词",
      creativePrompt: "新一轮场景",
      candidateContexts: {
        old: { lyrics: "旧歌歌词", creativePrompt: "旧歌场景" },
      },
    };
    expect(selectMusicCandidateContext(state, "old").lyrics).toBe("旧歌歌词");
    expect(selectMusicCandidateContext(state, "imported").lyrics).toBe("");
    const edited = {
      ...state,
      lyricsCandidateId: "old",
      lyrics: "校正旧歌歌词",
    };
    expect(
      selectMusicCandidateContext(edited, "other").candidateContexts.old.lyrics
    ).toBe("校正旧歌歌词");
  });
  it("只有同一真实提交身份绑定歌词，云草稿保留候选上下文", () => {
    const state: CanvasMusicMvState = {
      status: "music_ready",
      candidates: [],
      musicRequestId: "11111111-1111-4111-8111-111111111111",
      musicSubmission: {
        model: "suno-v6",
        custom_mode: true,
        instrumental: false,
        title: "歌",
        style: "pop",
        prompt: "原歌词",
        negative_tags: "",
        duration: 180,
        style_weight: 0,
        weirdness_constraint: 0.25,
      },
      musicSubmissionDirection: "原场景",
    };
    expect(captureMusicCandidateContexts(state, "another-job", ["x"])).toEqual(
      {}
    );
    const contexts = captureMusicCandidateContexts(
      state,
      "bgm_11111111111141118111111111111111",
      ["x", "y"]
    );
    expect(contexts.y).toEqual({ lyrics: "原歌词", creativePrompt: "原场景" });
    const block = defaultCanvasBlock("music", 0, 0);
    block.musicMv = { ...state, candidateContexts: contexts };
    // 合同解析也是云草稿读取/保存的共同边界。
    expect(
      canvasMusicMvStateSchema.parse(block.musicMv).candidateContexts?.x.lyrics
    ).toBe("原歌词");
    const snapshot = buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: [block], edges: [] });
    const restored = cloudDraftBlocksToCanvas(parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(snapshot))!.canvas.blocks)[0];
    expect(restored.musicMv?.candidateContexts).toEqual(contexts);
  });
});
