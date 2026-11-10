import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 前台零技术泄漏：回给前端的响应对象里，普通用户拿不到模型 / 通道 / 引擎名；监管与管理员原样可见。
 * 离线替身：fetch 一律抛错（任何上游调用都会让用例失败），任务记录由替身直接给出。
 */
const h = vi.hoisted(() => ({ auth: vi.fn(), getTask: vi.fn() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("./canvasVideoTask.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./canvasVideoTask.js")>()),
  getCanvasVideoTask: h.getTask,
}));
import jobsHandler from "../../api/jobs";
import {
  MODEL_INFO_RESPONSE_KEYS,
  canViewModelInfo,
  debugForRole,
  redactModelInfoForRole,
} from "../../shared/modelInfoExposure";

const LEAK_KEYS = ["provider", "model", "modelName", "modelUsed", "engine"];
const fetchMock = vi.fn();

async function canvasVideoStatus() {
  let status = 0, body: any;
  const res: any = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; return res; }, setHeader() { return res; }, end() { return res; } };
  await jobsHandler({ method: "GET", headers: {}, query: { op: "canvasVideoStatus", taskId: "t-1" }, body: {} } as never, res);
  return { status, body };
}

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.getTask.mockReset().mockResolvedValue({
    taskId: "t-1",
    status: "succeeded",
    videoUrl: "https://media.example/out.mp4",
    engine: "seedance-mini-evolink",
    provider: "evolink",
    model: "seedance-2.0-mini",
    workMode: "reference_to_video",
    resolution: "480p",
    duration: 5,
    creditsCharged: 10,
  });
  fetchMock.mockReset().mockRejectedValue(new Error("不应访问任何上游"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JWT_SECRET", "test-session-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("/api/jobs?op=canvasVideoStatus", () => {
  it("普通用户：响应里没有 engine / provider / model，轮询所需字段照常", async () => {
    const result = await canvasVideoStatus();
    expect(result.status).toBe(200);
    for (const key of LEAK_KEYS) expect(result.body).not.toHaveProperty(key);
    expect(JSON.stringify(result.body)).not.toMatch(/evolink|seedance/i);
    expect(result.body).toMatchObject({ ok: true, taskId: "t-1", status: "succeeded", videoUrl: "https://media.example/out.mp4", workMode: "reference_to_video", creditsUsed: 10 });
    expect(h.getTask).toHaveBeenCalledWith("t-1", 7);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["supervisor", "admin"])("%s：模型 / 通道 / 引擎原样可见", async (role) => {
    h.auth.mockResolvedValue({ id: 1, role });
    const result = await canvasVideoStatus();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ engine: "seedance-mini-evolink", provider: "evolink", model: "seedance-2.0-mini" });
  });
});

describe("shared/modelInfoExposure", () => {
  it("只有 supervisor / admin 能看模型信息", () => {
    expect(canViewModelInfo("supervisor")).toBe(true);
    expect(canViewModelInfo("admin")).toBe(true);
    for (const role of ["user", "", undefined, null, "Admin"]) expect(canViewModelInfo(role)).toBe(false);
  });

  it("redactModelInfoForRole：普通用户删全部模型字段、不改入参；监管原样", () => {
    const body = { ok: true, provider: "p", model: "m", modelName: "n", modelUsed: "u", engine: "e", reasoningEffort: "high", videoUrl: "v" };
    const user = redactModelInfoForRole(body, "user");
    for (const key of MODEL_INFO_RESPONSE_KEYS) expect(user).not.toHaveProperty(key);
    expect(user).toEqual({ ok: true, videoUrl: "v" });
    expect(body.model).toBe("m");
    expect(redactModelInfoForRole(body, "supervisor")).toBe(body);
    expect(redactModelInfoForRole(body, "user", ["model"])).toEqual({ ok: true, provider: "p", modelName: "n", modelUsed: "u", engine: "e", reasoningEffort: "high", videoUrl: "v" });
  });

  it("debugForRole：debug 块只给监管 / 管理员", () => {
    const debug = { route: "analyzeVideo", provider: "p", model: "m" };
    expect(debugForRole("user", debug)).toBeUndefined();
    expect(debugForRole(undefined, debug)).toBeUndefined();
    expect(debugForRole("admin", debug)).toBe(debug);
  });
});
