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
import { canvasAudioCueInputKey, createCanvasAudioCue, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";

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
      if (url !== "/api/jobs?op=seedanceI2V" || init?.method !== "POST") {
        throw new Error(`测试禁止真实网络与未声明请求：${url}`);
      }
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, videoUrl: RESULT, workMode: "reference_to_video" }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("漫剧工厂段级参考进出片请求（无网络）", () => {
  it("白模现签后排 @视频1、接力片在后；母轨作唯一音轨；提示词带段参考引导句", async () => {
    const block = segmentBlock();
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.version).toBe("2.5");
    expect(req.workMode).toBe("reference_to_video");
    expect((req.videoUrls as string[])[0]).toBe(PREVIS_FRESH);
    expect(req.videoUrls).not.toContain(PREVIS_STORED);
    // 有白模就不再送上段接力片：三条 30 s 叠到 90 s 会被拒
    expect(req.videoUrls).toEqual([PREVIS_FRESH]);
    expect(req.audioUrls).toEqual([MASTER_GCS]);
    expect(signRequests).toEqual([PREVIS_GCS]);
    const prompt = String(req.prompt);
    // 出片清洗把【】折成半角 []（【】是字幕标记），只认正文
    expect(prompt).toContain("@视频1是本段站位白模");
    expect(prompt).toContain("@音频1就是本片最终音轨");
  });
  it("现签失败退回已存链，不挡出片", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/google?op=materialReadUrl")) return new Response(JSON.stringify({ ok: false, message: "签名失败" }), { status: 500 });
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, videoUrl: RESULT }));
      }),
    );
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, segmentBlock());
    expect((requests[0]!.videoUrls as string[])[0]).toBe(PREVIS_STORED);
  });
  it("已采用逐句配音的段挂了母轨后，只送母轨一条音频", async () => {
    const cue = { ...createCanvasAudioCue("dialogue", "line-1"), speakerZh: "阿菁", voiceStateZh: "常态", voice: "Dylan", textZh: "别怕。", shotZh: "近景", approved: true, selectedTakeId: "take-1" };
    cue.takes.push({ id: "take-1", gcsUri: "gs://test-bucket/post-prod/1/line.wav", previewUrl: "", durationSec: 2, createdAt: "2026-09-08", inputKey: canvasAudioCueInputKey(cue) });
    const block = { ...segmentBlock(), audioStudio: { ...emptyCanvasAudioStudio(), cues: [cue] } };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests[0]!.audioUrls).toEqual([MASTER_GCS]);
    expect(String(requests[0]!.prompt)).not.toContain("@audio2");
  });
  it("10 秒试片不注入白模与母轨", async () => {
    const block = { ...segmentBlock(), refVideoUrl: undefined };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block, undefined, { pilotRun: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.videoUrls ?? []).not.toContain(PREVIS_FRESH);
    expect(requests[0]!.audioUrls ?? []).not.toContain(MASTER_GCS);
    expect(String(requests[0]!.prompt)).not.toContain("站位白模");
  });
  it("Seedance 2.0 系同样注入（OpenRouter 视频/音频各 ≤3 条）", async () => {
    const block = { ...segmentBlock(), videoModel: "seedance-2.0" as const, refVideoUrl: undefined };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect((requests[0]!.videoUrls as string[])[0]).toBe(PREVIS_FRESH);
    expect(requests[0]!.audioUrls).toEqual([MASTER_GCS]);
  });
  it("Wan 3.0：≤15 s 的白模/母轨才送，白模排 Reference video 1、母轨现签作唯一音频", async () => {
    const MASTER_FRESH = "https://test.invalid/master-fresh.wav?sig=new";
    let wanRequests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/google?op=materialReadUrl&gcsUri=")) {
          const gcsUri = decodeURIComponent(url.split("gcsUri=")[1]!);
          return new Response(JSON.stringify({ ok: true, url: gcsUri === PREVIS_GCS ? PREVIS_FRESH : MASTER_FRESH }));
        }
        if (url !== "/api/jobs?op=wan30Video") throw new Error(`未声明请求：${url}`);
        wanRequests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, videoUrl: RESULT }));
      }),
    );
    const base = segmentBlock();
    const short = {
      ...base,
      videoModel: "wan-3.0" as const,
      manhuaSegmentRefs: {
        previs: { ...base.manhuaSegmentRefs.previs, durationSec: 12 },
        master: { ...base.manhuaSegmentRefs.master, durationSec: 14.9 },
      },
    };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, short);
    expect(wanRequests).toHaveLength(1);
    expect(wanRequests[0]!.videoUrls).toEqual([PREVIS_FRESH]);
    expect(wanRequests[0]!.audioUrls).toEqual([MASTER_FRESH]);
    const prompt = String(wanRequests[0]!.prompt);
    expect(prompt).toContain("Reference video 1:本段站位白模");
    expect(prompt).toContain("Reference audio 1:本片最终音轨");

    wanRequests = [];
    const long = {
      ...short,
      manhuaSegmentRefs: {
        previs: { ...base.manhuaSegmentRefs.previs, durationSec: 30 },
        master: { ...base.manhuaSegmentRefs.master },
      },
    };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, long);
    expect(wanRequests[0]!.videoUrls ?? []).not.toContain(PREVIS_FRESH);
    // 超上限时接力片照旧送
    expect(wanRequests[0]!.videoUrls).toEqual([PREV_TAIL]);
    expect(wanRequests[0]!.audioUrls ?? []).not.toContain(MASTER_FRESH);
  });
  it("视频延长模式同样不注入白模/母轨：延长的必须是本段成片", async () => {
    const source = "https://test.invalid/segment-c.mp4";
    const block = {
      ...segmentBlock(),
      status: "done" as const,
      outputUrl: source,
      outputUrls: [source],
      seedance25WorkMode: "video_extend" as const,
      refVideoUrl: undefined,
    };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.videoUrls ?? []).not.toContain(PREVIS_FRESH);
    expect(requests[0]!.audioUrls ?? []).not.toContain(MASTER_GCS);
    expect(String(requests[0]!.prompt)).not.toContain("站位白模");
    expect(signRequests).toEqual([]);
  });
  it("局部编辑模式不注入白模：@视频1 必须是原片", async () => {
    const source = "https://test.invalid/segment-c.mp4";
    const block = {
      ...segmentBlock(),
      status: "done" as const,
      outputUrl: source,
      outputUrls: [source],
      seedance25WorkMode: "video_edit" as const,
      refVideoUrl: source,
      seedance25RefVideoUrls: [source],
      prompt: applyManhuaVideoEditInstruction(segmentBlock().prompt, "13—21秒家丁惊退两步，其余不动"),
    };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.workMode).toBe("video_edit");
    expect(requests[0]!.videoUrls).toEqual([source]);
    expect(String(requests[0]!.prompt)).not.toContain("段参考·白模");
    expect(signRequests).toEqual([]);
  });
  it("登记成片被拿去局部编辑时，过期登记链换成现签链", async () => {
    const stale = "https://test.invalid/registered-expired.mp4?sig=old";
    const fresh = "https://test.invalid/registered-fresh.mp4?sig=new";
    const gcs = "gs://test-bucket/uploads/u1/registered.mp4";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/google?op=materialReadUrl")) return new Response(JSON.stringify({ ok: true, url: fresh }));
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, videoUrl: RESULT, workMode: "video_edit" }));
      }),
    );
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g03",
      episodeIndex: 1,
      videoModel: "seedance-2.5" as const,
      status: "done" as const,
      outputUrl: stale,
      outputUrls: [stale],
      seedance25WorkMode: "video_edit" as const,
      refVideoUrl: stale,
      seedance25RefVideoUrls: [stale],
      manhuaSegmentRefs: { registered: { url: stale, gcsUri: gcs, updatedAt: "2026-09-09T00:00:00Z" } },
      prompt: applyManhuaVideoEditInstruction("【第3段·30s】\n0–30s：原片。", "家丁惊退两步"),
    };
    await runCanvasBlock({ ...deps, characterVoiceLocks: [] }, block);
    expect(requests[0]!.videoUrls).toEqual([fresh]);
  });
});
