import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock, type CanvasUploadedAsset } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import {
  createCanvasAssetResigner,
  resignCanvasBlockUploadedReferences,
} from "./canvasAssetResign";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: vi.fn(async () => ({ frames: [] })),
  extractVideoFramesFromUrl: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const STALE_IMG = "https://storage.test/uploads/u1/face.png?X-Goog-Signature=old1";
const STALE_IMG2 = "https://storage.test/uploads/u1/scene.png?X-Goog-Signature=old2";
const STALE_VID = "https://storage.test/uploads/u1/previs.mp4?X-Goog-Signature=old3";
const STALE_AUD = "https://storage.test/uploads/u1/line.wav?X-Goog-Signature=old4";
const NO_GCS_IMG = "https://storage.test/uploads/u1/legacy.png";
const freshOf = (gcsUri: string) =>
  `https://storage.test/${gcsUri.replace("gs://bucket/", "")}?X-Goog-Signature=fresh`;

const assets: CanvasUploadedAsset[] = [
  { id: "a1", url: STALE_IMG, previewUrl: STALE_IMG, fileName: "face.png", kind: "image", gcsUri: "gs://bucket/uploads/u1/face.png" },
  { id: "a2", url: STALE_IMG2, previewUrl: STALE_IMG2, fileName: "scene.png", kind: "image", gcsUri: "gs://bucket/uploads/u1/scene.png" },
  { id: "a3", url: STALE_VID, previewUrl: STALE_VID, fileName: "previs.mp4", kind: "video", gcsUri: "gs://bucket/uploads/u1/previs.mp4" },
  { id: "a4", url: STALE_AUD, previewUrl: STALE_AUD, fileName: "line.wav", kind: "audio", gcsUri: "gs://bucket/uploads/u1/line.wav" },
  { id: "a5", url: NO_GCS_IMG, previewUrl: NO_GCS_IMG, fileName: "legacy.png", kind: "image" },
];

/** 离线：只放行重签与视频提交两条路由；记录每次重签的 gcsUri 与出站请求体。 */
function offline(opts: { failSign?: boolean } = {}) {
  const requests: Record<string, unknown>[] = [];
  const signed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const m = /^\/api\/google\?op=materialReadUrl&gcsUri=(.+)$/.exec(url);
      if (m) {
        const gcsUri = decodeURIComponent(m[1]!);
        signed.push(gcsUri);
        if (opts.failSign) return new Response(JSON.stringify({ ok: false, error: "签名失败" }), { status: 500 });
        return new Response(JSON.stringify({ ok: true, url: freshOf(gcsUri) }));
      }
      if (url === "/api/jobs?op=seedanceI2V" && init?.method === "POST") {
        requests.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }));
      }
      throw new Error(`禁止真实网络：${url}`);
    }),
  );
  return { requests, signed };
}

describe("createCanvasAssetResigner", () => {
  it("命中带 gcsUri 的上传件才重签；同一 gcsUri 只签一次；数组保序", async () => {
    const sign = vi.fn(async (gcsUri: string) => freshOf(gcsUri));
    const r = createCanvasAssetResigner(assets, { sign, log: () => {} });
    const out = await r.many([STALE_VID, STALE_IMG, STALE_IMG, NO_GCS_IMG, "https://other.test/x.png"]);
    expect(out).toEqual([
      freshOf("gs://bucket/uploads/u1/previs.mp4"),
      freshOf("gs://bucket/uploads/u1/face.png"),
      freshOf("gs://bucket/uploads/u1/face.png"),
      NO_GCS_IMG,
      "https://other.test/x.png",
    ]);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(await r.one(undefined)).toBeUndefined();
    expect(await r.one("")).toBe("");
  });

  it("旧签名与新签名互认（去掉查询串后同路径）", async () => {
    const sign = vi.fn(async (gcsUri: string) => freshOf(gcsUri));
    const r = createCanvasAssetResigner(assets, { sign, log: () => {} });
    const otherSig = "https://storage.test/uploads/u1/face.png?X-Goog-Signature=older";
    expect(await r.one(otherSig)).toBe(freshOf("gs://bucket/uploads/u1/face.png"));
  });

  it("重签失败退回原链，不抛错", async () => {
    const sign = vi.fn(async () => { throw new Error("boom"); });
    const log = vi.fn();
    const r = createCanvasAssetResigner(assets, { sign, log });
    expect(await r.one(STALE_IMG)).toBe(STALE_IMG);
    expect(await r.many([STALE_VID, STALE_VID])).toEqual([STALE_VID, STALE_VID]);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
  });

  it("resignCanvasBlockUploadedReferences 只换引用字段与被重签条目，不改原节点", async () => {
    const sign = vi.fn(async (gcsUri: string) => freshOf(gcsUri));
    const r = createCanvasAssetResigner(assets, { sign, log: () => {} });
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "v1",
      refImageUrl: STALE_IMG,
      refVideoUrl: STALE_VID,
      editFusionUrls: [STALE_IMG2, NO_GCS_IMG],
      seedance25RefAudioUrls: [STALE_AUD],
      uploadedAssets: assets,
    };
    const before = JSON.stringify(block);
    const next = await resignCanvasBlockUploadedReferences(block, r);
    expect(JSON.stringify(block)).toBe(before);
    expect(next.refImageUrl).toBe(freshOf("gs://bucket/uploads/u1/face.png"));
    expect(next.refVideoUrl).toBe(freshOf("gs://bucket/uploads/u1/previs.mp4"));
    expect(next.editFusionUrls).toEqual([freshOf("gs://bucket/uploads/u1/scene.png"), NO_GCS_IMG]);
    expect(next.seedance25RefAudioUrls).toEqual([freshOf("gs://bucket/uploads/u1/line.wav")]);
    expect(next.seedance25RefVideoUrls).toBeUndefined();
    // 上传件副本同步成新链，后续按 a.url === refVideoUrl 判 kind 仍能命中
    expect(next.uploadedAssets.find((a) => a.id === "a3")?.url).toBe(next.refVideoUrl);
    expect(next.uploadedAssets.find((a) => a.id === "a5")?.url).toBe(NO_GCS_IMG);
    expect(sign).toHaveBeenCalledTimes(4);
  });
});

describe("runCanvasBlock：出片前按 gcsUri 统一重签上传件", () => {
  const prompt = "【第1段·10s】图片只提供人物身份。人物抬头看向镜头，缓慢推镜。";

  it("Seedance 2.5 多模态参考：imageUrls/videoUrls/audioUrls 全部换成新签名，一 gcsUri 一次", async () => {
    const { requests, signed } = offline();
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-resign",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt,
        refImageUrl: STALE_IMG,
        editFusionUrls: [STALE_IMG2, NO_GCS_IMG],
        refVideoUrl: STALE_VID,
        seedance25RefVideoUrls: [STALE_VID],
        seedance25RefAudioUrls: [STALE_AUD],
        uploadedAssets: assets,
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].imageUrls).toEqual([
      freshOf("gs://bucket/uploads/u1/face.png"),
      freshOf("gs://bucket/uploads/u1/scene.png"),
      NO_GCS_IMG,
    ]);
    expect(requests[0].videoUrls).toEqual([freshOf("gs://bucket/uploads/u1/previs.mp4")]);
    expect(requests[0].audioUrls).toEqual([freshOf("gs://bucket/uploads/u1/line.wav")]);
    expect(JSON.stringify(requests[0])).not.toContain("Signature=old");
    // previs.mp4 同时出现在 refVideoUrl 与 seedance25RefVideoUrls，只签一次
    expect([...signed].sort()).toEqual([
      "gs://bucket/uploads/u1/face.png",
      "gs://bucket/uploads/u1/line.wav",
      "gs://bucket/uploads/u1/previs.mp4",
      "gs://bucket/uploads/u1/scene.png",
    ]);
  });

  it("无扩展名上传视频重签后仍按上传记录 kind 进 videoUrls", async () => {
    const { requests } = offline();
    const noExt = "https://storage.test/uploads/u1/previs-no-ext?X-Goog-Signature=old9";
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-resign-noext",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt,
        refImageUrl: NO_GCS_IMG,
        refVideoUrl: noExt,
        uploadedAssets: [
          { id: "n1", url: noExt, previewUrl: noExt, fileName: "previs-no-ext", kind: "video", mimeType: "video/mp4", gcsUri: "gs://bucket/uploads/u1/previs-no-ext" },
        ],
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].videoUrls).toEqual([freshOf("gs://bucket/uploads/u1/previs-no-ext")]);
  });

  it("Wan 3.0 同样吃到新签名", async () => {
    const { requests, signed } = offline();
    vi.mocked(fetch).mockImplementation(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const m = /^\/api\/google\?op=materialReadUrl&gcsUri=(.+)$/.exec(u);
      if (m) {
        const gcsUri = decodeURIComponent(m[1]!);
        signed.push(gcsUri);
        return new Response(JSON.stringify({ ok: true, url: freshOf(gcsUri) }));
      }
      if (u === "/api/jobs?op=wan30Video" && init?.method === "POST") {
        requests.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }));
      }
      throw new Error(`禁止真实网络：${u}`);
    });
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-resign-wan",
        videoModel: "wan-3.0",
        prompt,
        refImageUrl: STALE_IMG,
        seedance25RefVideoUrls: [STALE_VID],
        uploadedAssets: assets,
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].imageUrls).toEqual([freshOf("gs://bucket/uploads/u1/face.png")]);
    expect(requests[0].videoUrls).toEqual([freshOf("gs://bucket/uploads/u1/previs.mp4")]);
  });

  it("重签接口失败：退回原链照常提交，不挡出片", async () => {
    const { requests, signed } = offline({ failSign: true });
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-resign-fallback",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt,
        refImageUrl: STALE_IMG,
        refVideoUrl: STALE_VID,
        uploadedAssets: assets,
      },
    );
    expect(signed.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].imageUrls).toEqual([STALE_IMG]);
    expect(requests[0].videoUrls).toEqual([STALE_VID]);
  });

  it("没有 gcsUri 的旧上传件不发重签请求", async () => {
    const { requests, signed } = offline();
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "video-resign-legacy",
        videoModel: "seedance-2.5",
        seedance25WorkMode: "reference_to_video",
        prompt,
        refImageUrl: NO_GCS_IMG,
        uploadedAssets: [assets[4]!],
      },
    );
    expect(signed).toEqual([]);
    expect(requests[0].imageUrls).toEqual([NO_GCS_IMG]);
  });
});
