import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LUX3D_API_BASE,
  LUX3D_IMG_TO_3D_CREATE_PATH,
  LUX3D_TASK_GET_PATH,
  Lux3dSubmitError,
  buildLux3dImgTo3dBody,
  pollLux3dTaskOnce,
  resolveLux3dCredential,
  selectLux3dGlbOutput,
  submitLux3dImgTo3d,
} from "./lux3dAdapter";

const cred = { region: "cn" as const, key: "k-test" };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lux3dAdapter · 请求体", () => {
  it("img 必须 https；faceCount 范围 10000–300000；只传显式字段", () => {
    expect(() => buildLux3dImgTo3dBody({ img: "http://x/y.png" })).toThrow(Lux3dSubmitError);
    expect(() => buildLux3dImgTo3dBody({ img: "https://x/y.png", faceCount: 5000 })).toThrow("faceCount");
    expect(buildLux3dImgTo3dBody({ img: "https://x/y.png" })).toEqual({ img: "https://x/y.png" });
    expect(buildLux3dImgTo3dBody({ img: "https://x/y.png", version: "G1-Turbo", faceCount: 100000, outputFormat: ["glb"], enablePbr: false, aiPredictSize: true })).toEqual({
      img: "https://x/y.png", version: "G1-Turbo", faceCount: 100000, outputFormat: ["glb"], enablePbr: false, aiPredictSize: true,
    });
  });

  it("凭证只从两个环境变量读；cn 优先；都没有 → null", () => {
    expect(resolveLux3dCredential()).toBeNull();
    vi.stubEnv("LUX3D_GLOBAL_API_KEY", " g ");
    expect(resolveLux3dCredential()).toEqual({ region: "international", key: "g" });
    vi.stubEnv("LUX3D_CN_API_KEY", "c");
    expect(resolveLux3dCredential()).toEqual({ region: "cn", key: "c" });
    expect(resolveLux3dCredential("international")).toEqual({ region: "international", key: "g" });
  });
});

describe("lux3dAdapter · 提交", () => {
  it("成功：Authorization 裸 key、POST 合同路径、d 为 taskid", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${LUX3D_API_BASE.cn}${LUX3D_IMG_TO_3D_CREATE_PATH}`);
      expect((init?.headers as Record<string, string>).Authorization).toBe("k-test");
      expect(JSON.parse(String(init?.body))).toEqual({ img: "https://x/y.png", version: "G1-Turbo", outputFormat: ["glb"] });
      return jsonResponse(200, { c: "0", d: 3515103, m: "", f: null });
    });
    const r = await submitLux3dImgTo3d({ img: "https://x/y.png", version: "G1-Turbo", outputFormat: ["glb"] }, { fetch: fetchMock as never, credential: cred });
    expect(r).toEqual({ taskId: "3515103", region: "cn" });
  });

  it("业务码 11003 → insufficient_credits；11001/429 → rate_limited；c=-1 → bad_request；401 → unauthorized", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { c: "11003", d: null, m: "insufficient credits", f: { metaData: { bizCode: "11003" } } }, "insufficient_credits"],
      [429, { c: "11001", d: null, m: "rate limit", f: { metaData: { bizCode: "11001" } } }, "rate_limited"],
      [200, { c: "-1", d: null, m: "img blank", f: null }, "bad_request"],
      [401, { c: "10004", d: null, m: "not logged in", f: { metaData: { bizCode: "10004" } } }, "unauthorized"],
    ];
    for (const [status, body, code] of cases) {
      const fetchMock = vi.fn(async () => jsonResponse(status, body));
      await expect(submitLux3dImgTo3d({ img: "https://x/y.png" }, { fetch: fetchMock as never, credential: cred })).rejects.toMatchObject({ name: "Lux3dSubmitError", code });
    }
  });

  it("网络异常 → unknown（结果未知，不自动重发）；无凭证 → unauthorized 且不发请求", async () => {
    const boom = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(submitLux3dImgTo3d({ img: "https://x/y.png" }, { fetch: boom as never, credential: cred })).rejects.toMatchObject({ code: "unknown" });
    expect(boom).toHaveBeenCalledTimes(1);
    const never = vi.fn();
    await expect(submitLux3dImgTo3d({ img: "https://x/y.png" }, { fetch: never as never, credential: null })).rejects.toMatchObject({ code: "unauthorized" });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("lux3dAdapter · 轮询", () => {
  const poll = (body: unknown, status = 200) =>
    pollLux3dTaskOnce("3515103", "cn", { fetch: vi.fn(async (url: string | URL | Request) => { expect(String(url)).toBe(`${LUX3D_API_BASE.cn}${LUX3D_TASK_GET_PATH}?taskid=3515103`); return jsonResponse(status, body); }) as never, credential: cred, now: () => 1000 });

  it("status 0/1 → running；3 → succeeded 带 glbUrl；4 → failed；6 → canceled", async () => {
    expect(await poll({ c: "0", d: { taskId: 3515103, status: 0, outputs: [] } })).toEqual({ state: "running", status: "initialized" });
    expect(await poll({ c: "0", d: { taskId: 3515103, status: 1, outputs: [] } })).toEqual({ state: "running", status: "running" });
    const ok = await poll({ c: "0", d: { taskId: 3515103, status: 3, outputs: [{ content: "https://cdn/x.zip" }, { content: "https://cdn/x.glb?sig=1" }] } });
    expect(ok).toEqual({ state: "succeeded", outputs: [{ content: "https://cdn/x.zip" }, { content: "https://cdn/x.glb?sig=1" }], glbUrl: "https://cdn/x.glb?sig=1", fetchedAtMs: 1000 });
    expect(await poll({ c: "0", d: { taskId: 3515103, status: 4 }, m: "generation failed" })).toEqual({ state: "failed", error: "generation failed" });
    expect(await poll({ c: "0", d: { taskId: 3515103, status: 6 } })).toEqual({ state: "canceled" });
  });

  it("成功但只有 ZIP/NOT_REQUESTED → reconcile（不冒充有 GLB）；5xx/429 → running；404 → reconcile", async () => {
    expect((await poll({ c: "0", d: { status: 3, outputs: [{ content: "https://cdn/x.zip" }, { content: "NOT_REQUESTED" }] } })).state).toBe("reconcile");
    expect(await poll({}, 503)).toEqual({ state: "running", status: "transient_http_503" });
    expect(await poll({}, 429)).toEqual({ state: "running", status: "transient_http_429" });
    expect((await poll({ c: "0", d: null }, 404)).state).toBe("reconcile");
    expect((await poll({ c: "-1", d: null })).state).toBe("reconcile");
  });

  it("selectLux3dGlbOutput 跳过 NOT_REQUESTED，按 .glb 或 format 识别", () => {
    expect(selectLux3dGlbOutput([{ content: "NOT_REQUESTED" }, { content: "https://a/m.GLB" }])).toBe("https://a/m.GLB");
    expect(selectLux3dGlbOutput([{ content: "https://a/m.bin", format: "glb" }])).toBe("https://a/m.bin");
    expect(selectLux3dGlbOutput([{ content: "https://a/m.zip" }])).toBe("");
  });
});
