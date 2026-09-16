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
