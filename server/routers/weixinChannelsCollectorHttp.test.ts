import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express, Request, RequestHandler, Response } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerWeixinChannelsCollectorHttpRoutes,
  stripWeixinChannelsImagePayload,
  verifyWeixinChannelsCollectorToken,
  weixinChannelsObservationSchema,
} from "./weixinChannelsCollectorHttp";
import { setWeixinChannelsCaptureEnabled } from "../growth/weixinChannelsMinerStore";

let storeFile = "";

async function callSafetyPause(params: { token?: string; body: unknown }) {
  let pauseHandler: RequestHandler | undefined;
  const app = {
    post(route: string, handler: RequestHandler) {
      if (route === "/api/internal/weixin-channels/pause") pauseHandler = handler;
      return app;
    },
    get() { return app; },
  } as unknown as Express;
  registerWeixinChannelsCollectorHttpRoutes(app);
  if (!pauseHandler) throw new Error("collector_pause_handler_missing");

  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      payload = body;
      return response;
    },
  } as unknown as Response;
  await pauseHandler({
    headers: params.token ? { "x-weixin-channels-collector-token": params.token } : {},
    body: params.body,
  } as Request, response, () => undefined);
  return { statusCode, payload };
}

async function callHeartbeat(params: { token?: string; body: unknown }) {
  let heartbeatHandler: RequestHandler | undefined;
  const app = {
    post(route: string, handler: RequestHandler) {
      if (route === "/api/internal/weixin-channels/heartbeat") heartbeatHandler = handler;
      return app;
    },
    get() { return app; },
  } as unknown as Express;
  registerWeixinChannelsCollectorHttpRoutes(app);
  if (!heartbeatHandler) throw new Error("collector_heartbeat_handler_missing");

  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      payload = body;
      return response;
    },
  } as unknown as Response;
  await heartbeatHandler({
    headers: params.token ? { "x-weixin-channels-collector-token": params.token } : {},
    body: params.body,
  } as Request, response, () => undefined);
  return { statusCode, payload };
}

async function callLocalStop(params: { token?: string; body: unknown }) {
  let stopHandler: RequestHandler | undefined;
  const app = {
    post(route: string, handler: RequestHandler) {
      if (route === "/api/internal/weixin-channels/stop") stopHandler = handler;
      return app;
    },
    get() { return app; },
  } as unknown as Express;
  registerWeixinChannelsCollectorHttpRoutes(app);
  if (!stopHandler) throw new Error("collector_stop_handler_missing");

  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      payload = body;
      return response;
    },
  } as unknown as Response;
  await stopHandler({
    headers: params.token ? { "x-weixin-channels-collector-token": params.token } : {},
    body: params.body,
  } as Request, response, () => undefined);
  return { statusCode, payload };
}

describe("weixinChannelsCollectorHttp", () => {
  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-http-"));
    storeFile = path.join(dir, "state.json");
    process.env.WEIXIN_CHANNELS_MINER_STORE_FILE = storeFile;
  });

  afterEach(() => {
    delete process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN;
    delete process.env.WEIXIN_CHANNELS_MINER_STORE_FILE;
  });

  it("未配置令牌时安全拒绝", () => {
    expect(verifyWeixinChannelsCollectorToken("anything")).toBe(false);
  });

  it("只接受完全一致的采集令牌", () => {
    process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN = "real-local-token";
    expect(verifyWeixinChannelsCollectorToken("real-local-token")).toBe(true);
    expect(verifyWeixinChannelsCollectorToken("real-local-token-x")).toBe(false);
  });

  it("心跳把网页控制版本返回给本机采集器", async () => {
    process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN = "real-local-token";
    const result = await callHeartbeat({
      token: "real-local-token",
      body: { clientId: "mac-client-1" },
    });
    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      enabled: false,
      controlRevision: 0,
      formalQualifiedTotal: 0,
    });
  });

  it("左上角停止面板只能经采集令牌持久关闭网页开关", async () => {
    process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN = "real-local-token";
    await setWeixinChannelsCaptureEnabled(true);

    const unauthorized = await callLocalStop({
      body: { clientId: "mac-client-1", source: "floating_control" },
    });
    expect(unauthorized.statusCode).toBe(401);

    const invalid = await callLocalStop({
      token: "real-local-token",
      body: { clientId: "mac-client-1", source: "browser" },
    });
    expect(invalid.statusCode).toBe(400);

    const stopped = await callLocalStop({
      token: "real-local-token",
      body: { clientId: "mac-client-1", source: "floating_control" },
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.payload).toMatchObject({
      ok: true,
      capture: { enabled: false, pausedBy: "user" },
    });
  });

  it("安全暂停接口拒绝未鉴权和不足三次的请求，只接受带令牌的三次熔断", async () => {
    process.env.WEIXIN_CHANNELS_COLLECTOR_TOKEN = "real-local-token";
    const unauthorized = await callSafetyPause({
      body: { reason: "persistent_black_screen", consecutiveFailures: 3 },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.payload).toMatchObject({ ok: false, error: "unauthorized" });

    const insufficient = await callSafetyPause({
      token: "real-local-token",
      body: { reason: "persistent_black_screen", consecutiveFailures: 2 },
    });
    expect(insufficient.statusCode).toBe(400);
    expect(insufficient.payload).toMatchObject({ ok: false, error: "invalid_safety_pause" });

    const accepted = await callSafetyPause({
      token: "real-local-token",
      body: { reason: "persistent_same_content", consecutiveFailures: 3 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.payload).toMatchObject({
      ok: true,
      capture: {
        enabled: false,
        pausedBy: "collector_safety_fuse",
        pauseReason: "persistent_same_content",
      },
    });
  });

  it("允许五点与真实评论最低预算，并拒绝客户端抬高预算", () => {
    const base = {
      observationId: "observation-1", videoIdentity: "a".repeat(64), taskId: "task-123", query: "AI视频", resultRank: 1,
      title: "AI视频教程", observedAt: "2026-08-14T00:00:00.000Z",
      likes: 3_000, shares: 2_000, comments: 10, evidence: "capture" as const,
      videoDurationSec: 60, captureBudgetMs: 25_000,
    };
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureElapsedMs: 24_999 }).success).toBe(true);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, videoIdentity: "not-a-stable-id", captureElapsedMs: 24_999 }).success).toBe(false);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureElapsedMs: 25_001 }).success).toBe(false);
    expect(weixinChannelsObservationSchema.safeParse({ ...base, captureBudgetMs: 26_000, captureElapsedMs: 24_000 }).success).toBe(false);
  });

  it("广告视频即使评论数达到门槛也不要求打开评论区", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "advertisement-1",
      taskId: "task-123",
      query: "AI视频",
      resultRank: 1,
      title: "AI工具推广",
      observedAt: "2026-08-14T00:00:00.000Z",
      likes: 8_998,
      shares: 12_000,
      comments: 361,
      ocrTexts: ["本内容包含 广告 推广"],
      evidence: "capture",
    });

    expect(result.success).toBe(true);
  });

  it("非广告视频评论数达到门槛时仍必须提供真实评论", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "organic-video-1",
      taskId: "task-123",
      query: "AI视频",
      resultRank: 1,
      title: "AI视频教程",
      observedAt: "2026-08-14T00:00:00.000Z",
      likes: 8_998,
      shares: 12_000,
      comments: 80,
      ocrTexts: ["AI视频制作教程"],
      evidence: "capture",
    });

    expect(result.success).toBe(false);
  });

  it("前置互动不达标时即使评论超过 80 也不要求评论样本", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "comments-only-1",
      taskId: "task-123",
      query: "AI视频",
      resultRank: 1,
      title: "普通视频",
      observedAt: "2026-08-14T00:00:00.000Z",
      likes: 822,
      shares: 32,
      favorites: 321,
      comments: 152,
      evidence: "capture",
    });

    expect(result.success).toBe(true);
  });

  it("接受有真实语义的代表画面元数据，不再假称视频号原始封面", () => {
    const result = weixinChannelsObservationSchema.safeParse({
      observationId: "visual-frame-1", videoIdentity: "a".repeat(64), taskId: "task-123", query: "AI视频", resultRank: 1,
      title: "AI视频教程", observedAt: "2026-08-14T00:00:00.000Z", likes: 3_000, shares: 2_000, comments: 10,
      evidence: "capture", visualImageBase64: "a".repeat(100), visualAssetKind: "representative_frame", visualFrameProgress: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("服务端兼容旧图片字段但在入库前一律剥离，视频号不再上传 GCS", () => {
    const structured = stripWeixinChannelsImagePayload({
      observationId: "visual-frame-1",
      title: "真实视频",
      coverImageBase64: "cover",
      visualImageBase64: "visual",
      visualAssetKind: "representative_frame",
      visualFrameProgress: 0.5,
    });
    expect(structured).toEqual({
      observationId: "visual-frame-1",
      title: "真实视频",
    });
  });
});
