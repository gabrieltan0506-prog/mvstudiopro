import { beforeEach, describe, expect, it, vi } from "vitest";
import { mvShotPlanMaxSec } from "../../shared/canvasMusicMvReferences";
import type { MusicMvLyricTable } from "../../shared/canvasMusicMv";

const h = vi.hoisted(() => ({ store: new Map<string, Buffer>() }));

vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  downloadGcsObjectVersioned: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
    const buffer = h.store.get(gcsUri);
    if (!buffer) throw new Error(`夹具缺对象 ${gcsUri}`);
    return { buffer };
  }),
  downloadGcsObject: vi.fn(async () => {
    throw new Error("方案自带 beatGrid，不应下载原歌");
  }),
  uploadBufferToGcsIfAbsent: vi.fn(async ({ bucket, objectName, buffer }: { bucket: string; objectName: string; buffer: Buffer }) => {
    const key = `gs://${bucket}/${objectName}`;
    if (h.store.has(key)) return { created: false };
    h.store.set(key, buffer);
    return { created: true };
  }),
}));
vi.mock("./musicMvBeatGrid", () => ({
  computeSongBeatGrid: vi.fn(async () => {
    throw new Error("方案自带 beatGrid，不应重算");
  }),
}));
vi.mock("./musicMvShotBeats", () => ({
  composeMusicMvShotBeats: vi.fn(async (input: { plan: unknown }) => ({ plan: input.plan, filledShotIds: [], failedShotIds: [], failuresZh: [] })),
}));
vi.mock("./musicMvFillPlan", () => ({
  composeMusicMvFillPlan: vi.fn(async () => {
    throw new Error("本夹具没有吟唱镜，不应补素材填充");
  }),
}));
vi.mock("./musicMvAdvisor", () => ({ composeCreativeAtHop: vi.fn() }));
vi.mock("./creativeLlmHops", () => ({ CREATIVE_LLM_HOPS: [] }));
vi.mock("./canvasMusicMvMedia", () => ({ resolveCanvasMusicMvAudio: vi.fn() }));

import { reviseMusicMvPlanForLyrics } from "./musicMvPlanRevision";

const USER = 7;
const BASE_ID = "22222222-2222-4222-8222-222222222222";
const evidence = (id: string, name: string) => `gs://test-bucket/canvas-music-mv/evidence/${USER}/${id}/${name}.json`;
const lines = [
  { text: "回家吧", startSec: 1, endSec: 9.6 },
  { text: "雨停了", startSec: 10, endSec: 16.6 },
  { text: "灯亮着", startSec: 17, endSec: 23 },
];
const lyricTable: MusicMvLyricTable = { requestId: "33333333-3333-4333-8333-333333333333", audioId: "song-60", range: { startSec: 0, endSec: 60 }, status: "confirmed", lines };
const highlight = { startSec: 0, endSec: 60 };

/**
 * 原分镜（顾问按 2.5 出的 60 秒高光）：s1/s2 两个 12 秒演唱镜，剪点 12 秒切在「雨停了」中间；
 * g1 28.7 秒生成镜，剪点 52.7 秒离拍点 53 秒 0.3 秒（吸附会把 g1 撑到 29 秒）。
 */
function seedBasePlan() {
  h.store.clear();
  const shot = (id: string, startSec: number, endSec: number, lyricQuote = "") => ({
    id, startSec, endSec, visualPrompt: "主角沿雨巷归家", cameraPrompt: "低机位缓慢跟拍", lyricQuote, referenceIndices: [0],
  });
  const input = {
    requestId: BASE_ID,
    audio: { id: "song-60", url: "https://example.test/a.mp3", durationSec: 60 },
    lyrics: "回家吧\n雨停了\n灯亮着",
    creativePrompt: "雨中归途",
    referenceSummaries: ["主角穿蓝外套"],
  };
  const plan = {
    version: 1,
    audioId: "song-60",
    audioDurationSec: 60,
    analysisBasis: "lyrics_and_user_description",
    beatGrid: { bpm: 60, beatSec: 1, phaseSec: 0, source: "creative_prompt" },
    shots: [shot("s1", 0, 12, "回家吧"), shot("s2", 12, 24, "雨停了"), shot("g1", 24, 52.7), shot("g2", 52.7, 60)],
  };
  h.store.set(evidence(BASE_ID, "result"), Buffer.from(JSON.stringify({ plan, input, evidence: {} })));
  h.store.set(evidence(BASE_ID, "settled"), Buffer.from(JSON.stringify({ settled: true })));
}
const lengths = (shots: ReadonlyArray<{ id: string; startSec: number; endSec: number }>) =>
  Object.fromEntries(shots.map(s => [s.id, Number((s.endSec - s.startSec).toFixed(3))]));
const revisionOf = (requestId: string) => JSON.parse(h.store.get(evidence(requestId, "revision"))!.toString("utf8"));

describe("按歌词修订分镜：单镜上限按所选视频模型（1109）", () => {
  beforeEach(seedBasePlan);

  it("传 Seedance 2.5：唱句剪点可把镜头拉过 14 秒，拍点吸附可到 29 秒，不越 29 秒", async () => {
    const out = await reviseMusicMvPlanForLyrics(USER, { basePlanRequestId: BASE_ID, lyricTable, highlight, videoModel: "seedance-2.5" });
    expect(mvShotPlanMaxSec("seedance-2.5")).toBe(29);
    expect(lengths(out.plan.shots)).toEqual({ s1: 9.8, s2: 14.2, g1: 29, g2: 7 });
    expect(Math.max(...out.plan.shots.map(s => s.endSec - s.startSec))).toBeLessThanOrEqual(29 + 1e-9);
    expect(out.changes).toContainEqual(expect.objectContaining({ id: "s2", action: "lyric_cut" }));
    expect(out.changes.some(c => c.action === "lyric_cut_unresolved")).toBe(false);
    const revision = revisionOf(out.requestId);
    expect(revision.shotLimit).toEqual({ videoModel: "seedance-2.5", maxShotSec: 29 });
    expect(revision.snapFixes).toEqual([expect.objectContaining({ shotId: "g2", action: "snap_cut", before: 52.7, after: 53 })]);
  });

  it("缺省模型：仍按保守值 max(原镜长, 14 秒)，唱句剪点记 unresolved、吸附不撑长", async () => {
    const out = await reviseMusicMvPlanForLyrics(USER, { basePlanRequestId: BASE_ID, lyricTable, highlight });
    expect(mvShotPlanMaxSec()).toBe(14);
    expect(lengths(out.plan.shots)).toEqual({ s1: 12, s2: 12, g1: 28.7, g2: 7.3 });
    expect(out.changes).toContainEqual(expect.objectContaining({ id: "s2", action: "lyric_cut_unresolved" }));
    const revision = revisionOf(out.requestId);
    expect(revision.shotLimit).toEqual({ videoModel: null, maxShotSec: 14 });
    expect(revision.snapFixes).toEqual([]);
  });
});
