import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 匿名可触发付费上游的历史入口加闸（离线替身：fetch 一律抛错，任何上游调用都会让用例失败）。 */
const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
import jobsHandler from "../../api/jobs";
import klingImageHandler from "../../api/kling-image";
import { decideLegacyJobsOpAccess, legacyJobsOpAccess } from "../../shared/internalMediaEndpointPolicy";
import { buildInternalGatewayHeaders, isInternalGatewayRequest, markInProcessGatewayRequest } from "./internalGatewayAuth";

const fetchMock = vi.fn();
async function call(handler: any, req: Record<string, unknown>) {
  let status = 0, body: any;
  const res: any = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; return res; }, setHeader() { return res; }, end() { return res; } };
  await handler({ headers: {}, query: {}, ...req }, res);
  return { status, body };
}
const jobs = (op: string, extra: Record<string, unknown> = {}) =>
  call(jobsHandler, { method: "POST", query: { op }, body: { prompt: "测试", imageUrl: "https://media.example/a.png", videoUrl: "https://media.example/a.mp4", taskId: "t1", dialogueText: "你好" }, ...extra });

const SUPERVISOR_OPS = ["probeGptKeys", "probeResponses", "platformIaBrief", "canvasIaBrief", "generateVoice", "klingCreate", "klingTask"];
const INTERNAL_OPS = ["scriptGenerate", "bananaGenerate", "falImageGenerate", "falImage", "klingT2V", "klingI2V"];
const MUSIC_OPS = ["aimusicSunoCreate", "aimusicSunoTask", "aimusicUdioCreate", "aimusicUdioTask"];
const LOGIN_OPS = ["suggestClipCuts", "extractClipAudio", "eraseAiCornerMark"];

beforeEach(() => {
  h.auth.mockReset().mockRejectedValue(Object.assign(new Error("Invalid session cookie"), { statusCode: 403 }));
  fetchMock.mockReset().mockRejectedValue(new Error("不应访问任何上游"));
  vi.stubGlobal("fetch", fetchMock);
  for (const key of ["KLING_CN_IMAGE_ACCESS_KEY", "KLING_CN_IMAGE_SECRET_KEY", "KLING_CN_VIDEO_ACCESS_KEY", "KLING_CN_VIDEO_SECRET_KEY", "AIMUSIC_API_KEY", "COMETAPI_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]) vi.stubEnv(key, "test-key");
  vi.stubEnv("JWT_SECRET", "test-session-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("/api/jobs 历史付费入口", () => {
  it.each([...SUPERVISOR_OPS, ...INTERNAL_OPS, ...MUSIC_OPS, ...LOGIN_OPS])("%s 未登录 → 401，不访问上游", async (op) => {
    const result = await jobs(op);
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("AUTHENTICATION_REQUIRED");
    // 大小写变体同样拦住
    expect((await jobs(op.toUpperCase())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([...SUPERVISOR_OPS, ...INTERNAL_OPS])("%s 普通登录用户 → 403，不访问上游", async (op) => {
    h.auth.mockResolvedValue({ id: 7, role: "user" });
    const result = await jobs(op);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("SUPERVISOR_ONLY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("管理员/监管放行测试台可灵入口；登录用户放行音乐入口（闸门之后才走到上游）", async () => {
    h.auth.mockResolvedValue({ id: 1, role: "admin" });
    expect((await jobs("klingTask")).status).not.toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    h.auth.mockResolvedValue({ id: 7, role: "user" });
    const music = await jobs("aimusicSunoTask");
    expect([401, 403]).not.toContain(music.status);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("内部身份：进程内标记与签名头放行内部档位，但不放行仅监管档位；伪造/过期签名无效", async () => {
    const signed = await jobs("aimusicUdioTask", { headers: buildInternalGatewayHeaders() });
    expect([401, 403]).not.toContain(signed.status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await jobs("klingCreate", { headers: buildInternalGatewayHeaders() })).status).toBe(401);
    expect((await jobs("aimusicUdioTask", { headers: { "x-mvs-internal-ts": String(Date.now()), "x-mvs-internal-sig": "forged" } })).status).toBe(401);
    expect((await jobs("aimusicUdioTask", { headers: buildInternalGatewayHeaders(Date.now() - 10 * 60_000) })).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(isInternalGatewayRequest(markInProcessGatewayRequest({ headers: {} }))).toBe(true);
    expect(isInternalGatewayRequest({ headers: {} })).toBe(false);
    vi.stubEnv("JWT_SECRET", "");
    expect(buildInternalGatewayHeaders()).toEqual({});
    expect(isInternalGatewayRequest({ headers: { "x-mvs-internal-ts": String(Date.now()), "x-mvs-internal-sig": "" } })).toBe(false);
  });

  it("档位判定表", () => {
    expect(legacyJobsOpAccess("seedanceI2V")).toBeNull();
    expect(legacyJobsOpAccess("toString")).toBeNull();
    expect(decideLegacyJobsOpAccess("internal_or_supervisor", { internal: true })).toEqual({ ok: true });
    expect(decideLegacyJobsOpAccess("supervisor", { internal: true })).toEqual({ ok: false, status: 401 });
    expect(decideLegacyJobsOpAccess("supervisor", { internal: false, userId: 1, role: "supervisor" })).toEqual({ ok: true });
    expect(decideLegacyJobsOpAccess("login", { internal: false, userId: 7, role: "user" })).toEqual({ ok: true });
    expect(decideLegacyJobsOpAccess("login", { internal: true })).toEqual({ ok: false, status: 401 });
  });
});

describe("/api/kling-image", () => {
  it("未登录 401、普通用户 403：出图、轮询、probe 都不访问上游", async () => {
    for (const req of [
      { method: "POST", body: { prompt: "测试" } },
      { method: "GET", query: { taskId: "t1" } },
      { method: "GET", query: { op: "probe" } },
    ]) {
      h.auth.mockRejectedValueOnce(new Error("no session"));
      expect((await call(klingImageHandler, req)).status).toBe(401);
      h.auth.mockResolvedValueOnce({ id: 7, role: "user" });
      expect((await call(klingImageHandler, req)).status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("管理员放行，走到上游", async () => {
    h.auth.mockResolvedValue({ id: 1, role: "admin" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { task_id: "t1" } }), { status: 200 }));
    const result = await call(klingImageHandler, { method: "POST", body: { prompt: "测试" } });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
