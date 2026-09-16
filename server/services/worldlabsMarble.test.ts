import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMarbleGenerateBody,
  marbleOperationHasError,
  parseMarbleWorldAssets,
  pollMarbleOperationOnce,
  submitMarbleGenerate,
} from "./worldlabsMarble.js";

describe("worldlabsMarble", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WORLDLABS_API_KEY;
  });

  it("请求体：text / image(is_pano) / multi-image 按官方字段", () => {
    expect(buildMarbleGenerateBody({ displayName: "a", model: "marble-1.0-draft", prompt: { type: "text", textPrompt: "船甲板" } })).toEqual({
      display_name: "a",
      model: "marble-1.0-draft",
      world_prompt: { type: "text", text_prompt: "船甲板" },
    });
    const img = buildMarbleGenerateBody({ displayName: "b", model: "marble-1.1", prompt: { type: "image", imageUrl: "https://x/p.jpg", isPano: true } });
    expect(img.world_prompt).toEqual({ type: "image", image_prompt: { source: "uri", uri: "https://x/p.jpg", is_pano: true } });
    const multi = buildMarbleGenerateBody({
      displayName: "c",
      model: "marble-1.1",
      prompt: { type: "multi-image", images: [{ azimuth: 0, imageUrl: "https://x/0.jpg" }, { azimuth: 180, imageUrl: "https://x/180.jpg" }], textPrompt: "夜" },
    });
    expect(multi.world_prompt).toEqual({
      type: "multi-image",
      multi_image_prompt: [
        { azimuth: 0, content: { source: "uri", uri: "https://x/0.jpg" } },
        { azimuth: 180, content: { source: "uri", uri: "https://x/180.jpg" } },
      ],
      text_prompt: "夜",
    });
  });

  it("error 对象恒在：code/message 都空不算失败", () => {
    expect(marbleOperationHasError({ error: { code: null, message: null } })).toBe("");
    expect(marbleOperationHasError({ error: null })).toBe("");
    expect(marbleOperationHasError({ error: { code: 7, message: "bad" } })).toBe("[7] bad");
    expect(marbleOperationHasError({ error: { code: null, message: "x" } })).toBe("x");
  });

  it("产物解析：三档 spz、尺度/地面、碰撞网格、全景", () => {
    const a = parseMarbleWorldAssets({
      world_id: "w1",
      world_marble_url: "https://marble/w1",
      assets: {
        splats: { spz_urls: { "100k": "https://s/100k.spz", "500k": "https://s/500k.spz", full_res: "https://s/full.spz" }, semantics_metadata: { metric_scale_factor: 2.4, ground_plane_offset: 1.6 } },
        mesh: { collider_mesh_url: "https://s/c.glb" },
        imagery: { pano_url: "https://s/p.jpg" },
        thumbnail_url: "https://s/t.jpg",
        caption: "deck",
      },
    });
    expect(a).toEqual({
      spzUrls: { "100k": "https://s/100k.spz", "500k": "https://s/500k.spz", full_res: "https://s/full.spz" },
      metricScaleFactor: 2.4,
      groundPlaneOffset: 1.6,
      colliderMeshUrl: "https://s/c.glb",
      panoUrl: "https://s/p.jpg",
      thumbnailUrl: "https://s/t.jpg",
      caption: "deck",
      worldMarbleUrl: "https://marble/w1",
    });
    expect(parseMarbleWorldAssets(null)).toEqual({ spzUrls: {} });
  });

  it("未配置钥匙：提交 rejected（没出站），轮询 reconcile", async () => {
    await expect(submitMarbleGenerate({ displayName: "x", model: "marble-1.1", prompt: { type: "text", textPrompt: "t" } })).rejects.toMatchObject({ kind: "rejected" });
    expect(await pollMarbleOperationOnce("op")).toMatchObject({ state: "reconcile" });
  });

  it("提交：4xx rejected、5xx unknown、缺 operation_id unknown、成功回 operation_id 与 world_id", async () => {
    process.env.WORLDLABS_API_KEY = "k";
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const responses: Response[] = [
      new Response("bad", { status: 422 }),
      new Response("boom", { status: 502 }),
      new Response(JSON.stringify({}), { status: 200 }),
      new Response(JSON.stringify({ operation_id: "op1", metadata: { world_id: "w1" } }), { status: 200 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return responses.shift() as Response;
    }));
    const input = { displayName: "x", model: "marble-1.1" as const, prompt: { type: "text" as const, textPrompt: "t" } };
    await expect(submitMarbleGenerate(input)).rejects.toMatchObject({ kind: "rejected" });
    await expect(submitMarbleGenerate(input)).rejects.toMatchObject({ kind: "unknown" });
    await expect(submitMarbleGenerate(input)).rejects.toMatchObject({ kind: "unknown" });
    expect(await submitMarbleGenerate(input)).toEqual({ operationId: "op1", worldId: "w1" });
    expect(calls[0].url).toBe("https://api.worldlabs.ai/marble/v1/worlds:generate");
    expect((calls[0].init?.headers as Record<string, string>)["WLT-Api-Key"]).toBe("k");
  });

  it("轮询：running / failed(error 非空) / completed 带产物 / 401 reconcile / 5xx running", async () => {
    process.env.WORLDLABS_API_KEY = "k";
    const responses: Response[] = [
      new Response(JSON.stringify({ done: false, error: { code: null, message: null }, metadata: { world_id: "w", progress: { status: "RUNNING" } } }), { status: 200 }),
      new Response(JSON.stringify({ done: true, error: { code: 3, message: "nsfw" } }), { status: 200 }),
      new Response(JSON.stringify({ done: true, error: { code: null, message: null }, metadata: { world_id: "w" }, response: { world_id: "w", assets: { splats: { spz_urls: { "500k": "https://s/500k.spz" } } } } }), { status: 200 }),
      new Response("nope", { status: 401 }),
      new Response("err", { status: 503 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift() as Response));
    expect(await pollMarbleOperationOnce("op")).toEqual({ state: "running", status: "RUNNING", worldId: "w" });
    expect(await pollMarbleOperationOnce("op")).toEqual({ state: "failed", error: "[3] nsfw" });
    expect(await pollMarbleOperationOnce("op")).toEqual({ state: "completed", worldId: "w", assets: { spzUrls: { "500k": "https://s/500k.spz" } } });
    expect(await pollMarbleOperationOnce("op")).toMatchObject({ state: "reconcile" });
    expect(await pollMarbleOperationOnce("op")).toMatchObject({ state: "running", status: "transient_http_503" });
  });
});

describe("worldlabsMarble depth_to_rgb（PR-11）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WORLDLABS_API_KEY;
  });

  it("WL-D01 请求体：depth_pano_image（不是 image）+ text_prompt + z_min/z_max；media_asset 与 uri 两种引用；坏 z 范围本地拒不打上游", async () => {
    const { buildMarbleDepthToRgbBody, submitMarbleDepthToRgb } = await import("./worldlabsMarble.js");
    const body = buildMarbleDepthToRgbBody({ depth: { source: "media_asset", mediaAssetId: "ma_1" }, textPrompt: "夜雨甲板", zMin: 0.3, zMax: 60 });
    expect(body).toEqual({ depth_pano_image: { source: "media_asset", media_asset_id: "ma_1" }, text_prompt: "夜雨甲板", z_min: 0.3, z_max: 60 });
    expect(body).not.toHaveProperty("image");
    expect(buildMarbleDepthToRgbBody({ depth: { source: "uri", uri: "https://x/d.png" }, textPrompt: "夜", zMin: 0.5, zMax: 40, seed: 7 })).toEqual({
      depth_pano_image: { source: "uri", uri: "https://x/d.png" },
      text_prompt: "夜",
      z_min: 0.5,
      z_max: 40,
      seed: 7,
    });
    expect(() => buildMarbleDepthToRgbBody({ depth: { source: "uri", uri: "https://x/d.png" }, textPrompt: "夜", zMin: 0, zMax: 40 })).toThrow("marble_depth_invalid_z_range");
    expect(() => buildMarbleDepthToRgbBody({ depth: { source: "uri", uri: "https://x/d.png" }, textPrompt: "夜", zMin: 40, zMax: 40 })).toThrow("marble_depth_invalid_z_range");
    expect(() => buildMarbleDepthToRgbBody({ depth: { source: "uri", uri: "https://x/d.png" }, textPrompt: "  ", zMin: 1, zMax: 40 })).toThrow("marble_depth_missing_text_prompt");

    process.env.WORLDLABS_API_KEY = "k";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ operation_id: "dop1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { depth: { source: "media_asset" as const, mediaAssetId: "ma_1" }, textPrompt: "夜", zMin: 0.3, zMax: 60 };
    expect(await submitMarbleDepthToRgb(input)).toEqual({ operationId: "dop1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/marble\/v1\/pano:depth_to_rgb$/);
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent).toEqual({ depth_pano_image: { source: "media_asset", media_asset_id: "ma_1" }, text_prompt: "夜", z_min: 0.3, z_max: 60 });
    // 本地拒 → 零上游调用
    await expect(submitMarbleDepthToRgb({ ...input, zMin: -1 })).rejects.toMatchObject({ kind: "rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 422 })));
    await expect(submitMarbleDepthToRgb(input)).rejects.toMatchObject({ kind: "rejected" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 502 })));
    await expect(submitMarbleDepthToRgb(input)).rejects.toMatchObject({ kind: "unknown" });
  });

  it("轮询：只认 response.pano_url（官方主合同）；别的层级不猜；done 无 pano_url → reconcile；error 非空 → failed；cost 原样带回", async () => {
    const { pollMarbleDepthToRgbOnce, pickMarbleDepthToRgbPanoUrl, pickMarbleOperationCost } = await import("./worldlabsMarble.js");
    process.env.WORLDLABS_API_KEY = "k";
    const responses: Response[] = [
      new Response(JSON.stringify({ done: true, error: { code: null, message: null }, response: { pano_url: "https://s/p1.jpg" }, cost: { total_credits: 150, line_items: [{ n: 1 }] } }), { status: 200 }),
      new Response(JSON.stringify({ done: true, error: { code: null, message: null }, response: { imagery: { pano_url: "https://s/p2.jpg" } } }), { status: 200 }),
      new Response(JSON.stringify({ done: true, error: { code: null, message: null }, response: {} }), { status: 200 }),
      new Response(JSON.stringify({ done: false, error: { code: null, message: null }, metadata: { progress: { status: "RUNNING" } } }), { status: 200 }),
      new Response(JSON.stringify({ done: true, error: { code: 9, message: "bad depth" } }), { status: 200 }),
      new Response("nope", { status: 404 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift() as Response));
    expect(await pollMarbleDepthToRgbOnce("dop")).toEqual({ state: "completed", panoUrl: "https://s/p1.jpg", cost: { totalCredits: 150, lineItems: [{ n: 1 }] } });
    expect(await pollMarbleDepthToRgbOnce("dop")).toMatchObject({ state: "reconcile" });
    expect(await pollMarbleDepthToRgbOnce("dop")).toMatchObject({ state: "reconcile" });
    expect(await pollMarbleDepthToRgbOnce("dop")).toEqual({ state: "running", status: "RUNNING" });
    expect(await pollMarbleDepthToRgbOnce("dop")).toEqual({ state: "failed", error: "[9] bad depth" });
    expect(await pollMarbleDepthToRgbOnce("dop")).toMatchObject({ state: "reconcile" });
    expect(pickMarbleDepthToRgbPanoUrl({ assets: { imagery: { pano_url: "https://s/p3.jpg" } } })).toBe("");
    expect(pickMarbleDepthToRgbPanoUrl({ pano_url: "gs://not-http" })).toBe("");
    // cost 可空：空≠零费，不伪造 0
    expect(pickMarbleOperationCost({ done: true })).toBeUndefined();
    expect(pickMarbleOperationCost({ cost: {} })).toEqual({});
  });
});

describe("worldlabsMarble media assets（官方 prepare_upload → PUT → media_asset_id）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WORLDLABS_API_KEY;
  });

  it("prepare 打 media-assets:prepare_upload（file_name ≤64、kind、extension）→ 按 required_headers PUT 字节 → 返回 media_asset_id；PUT 失败不算上传成功", async () => {
    const { uploadMarbleMediaAsset, parseMarblePrepareUploadResponse, sanitizeMarbleMediaFileName } = await import("./worldlabsMarble.js");
    process.env.WORLDLABS_API_KEY = "k";
    const prepared = { media_asset: { media_asset_id: "ma_9", kind: "image" }, upload_info: { upload_url: "https://upload.example/x", upload_method: "PUT", required_headers: { "x-goog-meta-a": "1" } } };
    const fetchMock = vi.fn(async (url: string) => (String(url).includes("prepare_upload") ? new Response(JSON.stringify(prepared), { status: 200 }) : new Response("", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await uploadMarbleMediaAsset({ bytes, contentType: "image/png", fileName: "depth-mw_abc.png", kind: "image", extension: "png" })).toEqual({ mediaAssetId: "ma_9" });
    const [prepUrl, prepInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(prepUrl).toMatch(/\/marble\/v1\/media-assets:prepare_upload$/);
    expect(JSON.parse(String(prepInit.body))).toEqual({ file_name: "depth-mw_abc.png", kind: "image", extension: "png" });
    const [putUrl, putInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(putUrl).toBe("https://upload.example/x");
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toEqual({ "Content-Type": "image/png", "x-goog-meta-a": "1" });
    expect(new Uint8Array(await (putInit.body as Blob).arrayBuffer())).toEqual(bytes);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("prepare_upload") ? new Response(JSON.stringify(prepared), { status: 200 }) : new Response("denied", { status: 403 }))));
    await expect(uploadMarbleMediaAsset({ bytes, contentType: "image/png", fileName: "d.png", kind: "image", extension: "png" })).rejects.toMatchObject({ kind: "rejected", message: expect.stringContaining("marble_media_put_http_403") });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    await expect(uploadMarbleMediaAsset({ bytes, contentType: "image/png", fileName: "d.png", kind: "image", extension: "png" })).rejects.toMatchObject({ kind: "rejected" });

    expect(() => parseMarblePrepareUploadResponse({ media_asset: {}, upload_info: {} })).toThrow("marble_media_prepare_bad_response");
    expect(sanitizeMarbleMediaFileName("深度 pano/../x".repeat(20), "png").length).toBeLessThanOrEqual(64);
    expect(sanitizeMarbleMediaFileName("a b.PNG", ".png")).toBe("a-b.png");
  });
});
