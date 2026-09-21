import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({
  tailFrames: vi.fn(async (_url: string, _options?: unknown) => ({ frames: [] })),
  duration: vi.fn(async (_url: string) => 30),
}));
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: media.tailFrames,
  extractVideoFramesFromUrl: vi.fn(),
}));
vi.mock("./videoUpscaleApi", () => ({ probeVideoDurationSec: media.duration }));
vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

import { defaultCanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { applyManhuaVideoEditInstruction } from "./manhuaMediaVersions";
import { canvasAudioCueInputKey, canvasAudioMixSource, getSelectedAudioTake, createCanvasAudioCue, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";

const RESULT = "https://test.invalid/segment-result.mp4";
const PREVIS_STORED = "https://test.invalid/previs-expired.mp4?sig=old";
const PREVIS_FRESH = "https://test.invalid/previs-fresh.mp4?sig=new";
const PREVIS_GCS = "gs://test-bucket/uploads/u1/previs.mp4";
const MASTER_GCS = "gs://test-bucket/uploads/u1/master.wav";
const PREV_TAIL = "https://test.invalid/previous.mp4";
const deps = { userId: "test-user", userRole: "admin", optimizeCopy: async () => "" };
let requests: Array<Record<string, unknown>>;
let signRequests: string[];

function segmentBlock() {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g02",
    episodeIndex: 1,
    videoModel: "seedance-2.5" as const,
    refImageUrl: "https://test.invalid/keyart.png",
    refVideoUrl: PREV_TAIL,
    prompt: "【第2段·30s】\n0–13s：阿菁护住墨屠，家丁施法。\n13–21s：墨屠变身完全体。\n21–30s：黑翼护住阿菁。",
    manhuaSegmentRefs: {
      previs: { url: PREVIS_STORED, gcsUri: PREVIS_GCS, fileName: "白模v2.mp4", updatedAt: "2026-09-09T00:00:00Z" },
      master: { url: "https://test.invalid/master-expired.wav", gcsUri: MASTER_GCS, fileName: "母轨v5.wav", updatedAt: "2026-09-09T00:00:00Z" },
    },
  };
}

beforeEach(() => {
  requests = [];
  signRequests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/google?op=materialReadUrl&gcsUri=")) {
        const gcsUri = decodeURIComponent(url.split("gcsUri=")[1]!);
        signRequests.push(gcsUri);
        return new Response(JSON.stringify({ ok: true, url: gcsUri === PREVIS_GCS ? PREVIS_FRESH : "https://test.invalid/other.bin" }));
      }
      if (!["/api/jobs?op=seedanceI2V", "/api/jobs?op=hailuo3Video"].includes(url) || init?.method !== "POST") {
        throw new Error(`测试禁止真实网络与未声明请求：${url}`);
      }
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, videoUrl: RESULT, workMode: "reference_to_video" }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());


import { buildPremixTimelineClips } from "./manhuaPremixMaster";
function audioBlock(kind: "bgm" | "sfx" = "bgm") {
  const cue = { ...createCanvasAudioCue(kind, "sound-1"), startSec: 0, endSec: 5, approved: true, selectedTakeId: "take-1", mix: { duckUnderDialogue: false, duckVolume: 0.25, silenceWindows: [{ startSec: 1, endSec: 2 }] } };
  cue.takes.push({ id: "take-1", gcsUri: "gs://test-bucket/post-prod/1/sound.wav", previewUrl: "", durationSec: 5, createdAt: "2026-09-20", inputKey: canvasAudioCueInputKey(cue) });
  const studio = { ...emptyCanvasAudioStudio(), cues: [cue] };
  return { ...segmentBlock(), prompt: "【第2段·5s】0–5s：阿菁推门，听见脚步。", refVideoUrl: undefined, seedance25WorkMode: "reference_to_video" as const, audioStudio: studio, manhuaSegmentRefs: { master: { url: "https://test.invalid/master.wav", gcsUri: MASTER_GCS, durationSec: 5, fileName: "预混.wav", updatedAt: "2026-09-20", audioStudioSource: canvasAudioMixSource(studio.cues, 5) } } };
}
describe("声音消费门禁：真实出片函数", () => {
  it("H3真实出片入口将显式声音参考传入jobs", async () => {
    const block = { ...segmentBlock(), id: "video-h3-ref", videoModel: "minimax-hailuo-3" as const,
      prompt: "@图片1 人物用 @音频1 说话", refVideoUrl: undefined, manhuaSegmentRefs: undefined,
      seedance25RefAudioUrls: [MASTER_GCS] };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0].audioUrls).toEqual([MASTER_GCS]);
    expect(String(requests[0].prompt)).toContain("Audio 1");
  });
  it("H3白模参考重新签名后仍保留Video 1动作职责", async () => {
    const base = segmentBlock();
    const block = { ...base, videoModel: "minimax-hailuo-3" as const, refVideoUrl: undefined,
      prompt: "【第2段·5s】0–5s：人物背负前行。",
      manhuaSegmentRefs: { previs: { ...base.manhuaSegmentRefs.previs, durationSec: 5, motionGuideZh: "背负前行，保持接触" } } };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0].videoUrls).toEqual([PREVIS_FRESH]);
    expect(String(requests[0].prompt)).toContain("Video 1");
    expect(String(requests[0].prompt)).toContain("背负前行，保持接触");
  });
  it.each(["happyhorse-1.1"] as const)("%s 即使有母轨也不能放行丢声音", async videoModel => {
    await expect(runCanvasBlock(deps, { ...audioBlock(), videoModel })).rejects.toThrow(/不支持声音参考/);
    expect(requests).toEqual([]);
  });
  it.each(["text_to_video", "image_to_video", "video_extend"] as const)("明确%s不能因母轨存在绕过声音守卫", async seedance25WorkMode => {
    await expect(runCanvasBlock(deps, { ...audioBlock(), seedance25WorkMode })).rejects.toThrow(/多模态参考模式/);
    expect(requests).toEqual([]);
  });
  it("只有母轨没有cue仍拒绝不支持声音的引擎", async () => {
    await expect(runCanvasBlock(deps, { ...audioBlock(), audioStudio: undefined, videoModel: "happyhorse-1.1" })).rejects.toThrow(/不支持声音参考/);
    expect(requests).toEqual([]);
  });
  it("留白未预混或旧上传母轨无来源指纹时拒绝，不发送原take冒充混音", async () => {
    const block = audioBlock();
    await expect(runCanvasBlock(deps, { ...block, manhuaSegmentRefs: undefined })).rejects.toThrow(/先.*预混母轨/);
    await expect(runCanvasBlock(deps, { ...block, manhuaSegmentRefs: { master: { ...block.manhuaSegmentRefs.master, audioStudioSource: undefined } } })).rejects.toThrow(/先.*预混母轨/);
    expect(requests).toEqual([]);
  });
  it.each(["bgm", "sfx"] as const)("纯%s经真实预混计划保留留白，当前指纹母轨成为唯一出片声音", async kind => {
    const block = audioBlock(kind);
    const clips = buildPremixTimelineClips({ cues: block.audioStudio.cues, durationSec: 5, getSelectedTake: getSelectedAudioTake, inputKeyOf: canvasAudioCueInputKey, videoModel: block.videoModel });
    expect(clips.map(c => [c.startSec, c.sourceStartSec, c.sourceEndSec])).toEqual([[0, 0, 1], [2, 2, 5]]);
    expect(clips.every(c => c.audioUri === block.audioStudio.cues[0]!.takes[0]!.gcsUri)).toBe(true);
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.audioUrls).toEqual([MASTER_GCS]);
    expect(String(requests[0]!.prompt)).toContain("@音频1就是本片最终音轨");
  });
  it("只有对白避让也必须预混，不能直接发送原曲", async () => {
    const block = audioBlock(); block.audioStudio.cues[0]!.mix = { duckUnderDialogue: true, duckVolume: 0.25, silenceWindows: [] };
    await expect(runCanvasBlock(deps, { ...block, manhuaSegmentRefs: undefined })).rejects.toThrow(/预混母轨/);
    expect(requests).toEqual([]);
  });
  it("预混只含部分采用音轨时不得静默跳过另一个启用cue", async () => {
    const block = audioBlock(); block.audioStudio.cues.push({ ...block.audioStudio.cues[0]!, id: "unapproved", approved: false });
    await expect(runCanvasBlock(deps, block)).rejects.toThrow(/启用但未采用/);
    expect(requests).toEqual([]);
  });
  it("采用后再改留白使同ID旧母轨失效", async () => {
    const block = audioBlock(); block.audioStudio.cues[0]!.mix!.silenceWindows[0]!.endSec = 3;
    await expect(runCanvasBlock(deps, block)).rejects.toThrow(/预混母轨仍为旧版/);
    expect(requests).toEqual([]);
  });
});
