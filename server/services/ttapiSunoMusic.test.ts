import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTtapiSunoTask,
  decodeTtapiSunoTaskId,
  encodeTtapiSunoTaskId,
  getTtapiSunoTask,
  isTtapiSunoReady,
  isTtapiSunoSubmissionUnknown,
  resolveTtapiSunoMv,
} from "./ttapiSunoMusic";

const JOB = "a1b2c3d4e5f60718";

describe("ttapiSunoMusic（Suno v6 · TTAPI 网关客户端）", () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let reply: (url: string) => { status: number; body: unknown };
  beforeEach(() => {
    calls.length = 0;
    process.env.TTAPI_KEY = "test-key";
    delete process.env.TTAPI_SUNO_MV_V6;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const r = reply(url);
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TTAPI_KEY;
  });

  it("未配置 TTAPI_KEY 即不可用；task id 前缀区分来源，往返一致", () => {
    delete process.env.TTAPI_KEY;
    expect(isTtapiSunoReady()).toBe(false);
    const id = encodeTtapiSunoTaskId(JOB);
    expect(id).toBe(`ttapi:${JOB}`);
    expect(decodeTtapiSunoTaskId(id)).toBe(JOB);
    expect(decodeTtapiSunoTaskId("task-unified-123")).toBeNull();
    expect(decodeTtapiSunoTaskId("ttapi:not a job")).toBeNull();
    expect(() => encodeTtapiSunoTaskId("bad id")).toThrow();
  });

  it("模型代号默认 v6=chirp-v6 / wild / mini，环境变量可改", () => {
    expect(resolveTtapiSunoMv("suno-v6")).toBe("chirp-v6");
    expect(resolveTtapiSunoMv("suno-v6-wild")).toBe("chirp-v6-wild");
    expect(resolveTtapiSunoMv("suno-v6-mini")).toBe("chirp-v6-mini");
    process.env.TTAPI_SUNO_MV_V6 = "chirp-v6-1";
    expect(resolveTtapiSunoMv("suno-v6")).toBe("chirp-v6-1");
  });

  it("建单：走 /suno/v1/music、TT-API-KEY 头、custom=true，纯 BGM 强制器乐，返回 jobId 编成 task id", async () => {
    reply = () => ({ status: 200, body: { status: "SUCCESS", message: "success", data: { jobId: JOB } } });
    const out = await createTtapiSunoTask({
      model: "suno-v6-mini",
      prompt: "[Intro] 蓄力 [Build] 冲突",
      style: "国风弦乐，战鼓，纯器乐",
      title: "剧情配乐",
      instrumental: true,
      negative_tags: "vocals",
    });
    expect(calls[0]!.url).toBe("https://api.ttapi.io/suno/v1/music");
    expect((calls[0]!.init?.headers as Record<string, string>)["TT-API-KEY"]).toBe("test-key");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toMatchObject({ mv: "chirp-v6-mini", prompt: "[Intro] 蓄力 [Build] 冲突", tags: "国风弦乐，战鼓，纯器乐", title: "剧情配乐", custom: true, instrumental: true, negative_tags: "vocals", audio_format: "mp3" });
    expect(out).toEqual({ taskId: `ttapi:${JOB}`, jobId: JOB, mv: "chirp-v6-mini" });
  });

  it("轮询：ON_QUEUE 继续等；SUCCESS 取全部 audioUrl，少于两首记 missing；FAILED 失败；SUCCESS 没地址也算失败", async () => {
    const id = encodeTtapiSunoTaskId(JOB);
    reply = () => ({ status: 200, body: { status: "ON_QUEUE", data: { progress: "40%", musics: [] } } });
    expect(await getTtapiSunoTask(id)).toMatchObject({ status: "pending", progress: 40 });
    expect(calls.at(-1)!.url).toBe(`https://api.ttapi.io/suno/v2/fetch?jobId=${JOB}`);
    reply = () => ({ status: 200, body: { status: "SUCCESS", data: { musics: [{ musicId: "m1", audioUrl: "https://cdn/a.mp3", duration: 180.2 }, { musicId: "m2", audioUrl: "https://cdn/b.mp3" }] } } });
    expect(await getTtapiSunoTask(id)).toMatchObject({ status: "completed", audioUrls: ["https://cdn/a.mp3", "https://cdn/b.mp3"], missing: 0 });
    reply = () => ({ status: 200, body: { status: "SUCCESS", data: { musics: [{ musicId: "m1", audioUrl: "https://cdn/a.mp3" }] } } });
    expect(await getTtapiSunoTask(id)).toMatchObject({ status: "completed", audioUrls: ["https://cdn/a.mp3"], missing: 1 });
    reply = () => ({ status: 200, body: { status: "SUCCESS", data: { musics: [{ musicId: "m1", audioUrl: "http://insecure/a.mp3" }] } } });
    expect((await getTtapiSunoTask(id)).status).toBe("failed");
    reply = () => ({ status: 200, body: { status: "FAILED", message: "moderation" } });
    expect(await getTtapiSunoTask(id)).toMatchObject({ status: "failed", reason: "配乐生成未成功，请保留原任务供服务端核对" });
  });

  it("401/403/429 明确拒绝；非 JSON 明确报错；错误信息不带正文与鉴权头", async () => {
    reply = () => ({ status: 401, body: "TT-API-KEY test-key invalid" });
    const e401 = await getTtapiSunoTask(encodeTtapiSunoTaskId(JOB)).catch((e) => e);
    expect(e401).toMatchObject({ code: "rejected", httpStatus: 401, submissionUnknown: false });
    expect(e401.message).not.toMatch(/test-key|TT-API-KEY/);
    reply = () => ({ status: 429, body: "Too Many Requests" });
    await expect(getTtapiSunoTask(encodeTtapiSunoTaskId(JOB))).rejects.toMatchObject({ httpStatus: 429, submissionUnknown: false });
    reply = () => ({ status: 200, body: "<html>oops</html>" });
    await expect(getTtapiSunoTask(encodeTtapiSunoTaskId(JOB))).rejects.toMatchObject({ code: "invalid_response", submissionUnknown: false });
  });

  const request = { model: "suno-v6" as const, prompt: "结构要求", style: "弦乐", title: "测试", instrumental: true };

  it("带人声请求不被改成纯器乐，中文歌名与歌词保持原样", async () => {
    reply = () => ({ status: 200, body: { status: "SUCCESS", data: { jobId: JOB } } });
    const style = "中式流行情歌，65 BPM，男声，传统乐器与当代管弦乐";
    await createTtapiSunoTask({ ...request, instrumental: false, title: "别爱我又不想说", prompt: "[Verse]\n你把晚风留在窗外", style });
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ instrumental: false, title: "别爱我又不想说", prompt: "[Verse]\n你把晚风留在窗外", tags: style, mv: "chirp-v6" });
  });

  it("POST 断线、5xx、坏 JSON、200 无 jobId 均保留未知状态，且绝不自动重试", async () => {
    for (const response of [
      { status: 502, body: "upstream lost" },
      { status: 200, body: "not json" },
      { status: 200, body: { status: "SUCCESS", data: {} } },
      { status: 200, body: { status: "FAILED", data: { jobId: JOB } } },
    ]) {
      calls.length = 0;
      reply = () => response;
      const error = await createTtapiSunoTask(request).catch((e) => e);
      expect(isTtapiSunoSubmissionUnknown(error)).toBe(true);
      expect(calls).toHaveLength(1);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test-key transport")));
    await expect(createTtapiSunoTask(request)).rejects.toMatchObject({ submissionUnknown: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("明确拒绝（403/429）与尚未发出的请求不标未知；错误中不夹带上游正文或鉴权", async () => {
    reply = () => ({ status: 403, body: "TT-API-KEY: test-key" });
    const error = await createTtapiSunoTask(request).catch((e) => e);
    expect(error).toMatchObject({ httpStatus: 403, submissionUnknown: false });
    expect(error.message).not.toMatch(/test-key|TT-API-KEY/);
    reply = () => ({ status: 429, body: "slow down" });
    await expect(createTtapiSunoTask(request)).rejects.toMatchObject({ httpStatus: 429, submissionUnknown: false });
    const controller = new AbortController();
    controller.abort(new Error("test-key"));
    calls.length = 0;
    await expect(createTtapiSunoTask(request, { abortSignal: controller.signal })).rejects.toMatchObject({ submissionUnknown: false });
    expect(calls).toHaveLength(0);
  });
});
