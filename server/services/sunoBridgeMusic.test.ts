import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSunoBridgeTask,
  decodeSunoBridgeTaskId,
  encodeSunoBridgeTaskId,
  getSunoBridgeTask,
  isSunoBridgeReady,
  isSunoBridgeSubmissionUnknown,
  resolveSunoBridgeChirpModel,
} from "./sunoBridgeMusic";

const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-8999-000000000000";

describe("sunoBridgeMusic（内部专用 cookie 桥客户端）", () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let reply: (url: string) => { status: number; body: unknown };
  beforeEach(() => {
    calls.length = 0;
    process.env.SUNO_BRIDGE_URL = "http://mvstudiopro-suno-bridge.internal:3000/";
    delete process.env.SUNO_BRIDGE_MODEL_V6;
    delete process.env.SUNO_BRIDGE_MODEL_V6_MINI;
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
    delete process.env.SUNO_BRIDGE_URL;
  });

  it("未配置 SUNO_BRIDGE_URL 即不可用；task id 前缀区分来源，往返一致", () => {
    delete process.env.SUNO_BRIDGE_URL;
    expect(isSunoBridgeReady()).toBe(false);
    const id = encodeSunoBridgeTaskId([A, B]);
    expect(id.startsWith("sunobridge:")).toBe(true);
    expect(decodeSunoBridgeTaskId(id)).toEqual([A, B]);
    expect(decodeSunoBridgeTaskId("task-unified-123")).toBeNull();
    expect(decodeSunoBridgeTaskId("sunobridge:not a uuid")).toBeNull();
  });

  it("网页代号默认 v6-mini=chirp-goose / v6=chirp-hawk，环境变量可改", () => {
    expect(resolveSunoBridgeChirpModel("suno-bridge-v6-mini")).toBe("chirp-goose");
    expect(resolveSunoBridgeChirpModel("suno-bridge-v6")).toBe("chirp-hawk");
    expect(resolveSunoBridgeChirpModel("suno-bridge-v6-wild")).toBe("chirp-hawk-wild");
    process.env.SUNO_BRIDGE_MODEL_V6 = "chirp-fenix";
    expect(resolveSunoBridgeChirpModel("suno-bridge-v6")).toBe("chirp-fenix");
  });

  it("建单：纯 BGM 保留段落结构且强制器乐，wait_audio=false，返回两条 clip 编成一个 task id", async () => {
    reply = () => ({ status: 200, body: [{ id: A, status: "submitted" }, { id: B, status: "submitted" }] });
    const out = await createSunoBridgeTask({
      model: "suno-bridge-v6-mini",
      prompt: "[Intro] 蓄力 [Build] 冲突",
      style: "国风弦乐，战鼓，纯器乐",
      title: "剧情配乐",
      instrumental: true,
      negative_tags: "vocals",
    });
    expect(calls[0]!.url).toBe("http://mvstudiopro-suno-bridge.internal:3000/api/custom_generate");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toMatchObject({ prompt: "[Intro] 蓄力 [Build] 冲突", tags: "国风弦乐，战鼓，纯器乐", title: "剧情配乐", make_instrumental: true, model: "chirp-goose", wait_audio: false, negative_tags: "vocals" });
    expect(out.clipIds).toEqual([A, B]);
    expect(out.taskId).toBe(`sunobridge:${A},${B}`);
    expect(out.chirpModel).toBe("chirp-goose");
  });

  it("轮询：全部终态才结算；一 complete 一 error 算完成并记 missing；全 error 才失败；缺 clip 继续 pending", async () => {
    const id = encodeSunoBridgeTaskId([A, B]);
    reply = () => ({ status: 200, body: [{ id: B, status: "complete", audio_url: "https://cdn/b.mp3" }, { id: A, status: "streaming", audio_url: "https://cdn/a-partial.mp3" }] });
    expect(await getSunoBridgeTask(id)).toMatchObject({ status: "pending", readyUrls: ["https://cdn/b.mp3"] });
    expect(calls.at(-1)!.url).toContain(`/api/get?ids=${encodeURIComponent(`${A},${B}`)}`);
    reply = () => ({ status: 200, body: [{ id: B, status: "complete", audio_url: "https://cdn/b.mp3" }, { id: A, status: "complete", audio_url: "https://cdn/a.mp3" }] });
    const done = await getSunoBridgeTask(id);
    expect(done).toMatchObject({ status: "completed", audioUrls: ["https://cdn/a.mp3", "https://cdn/b.mp3"] });
    reply = () => ({ status: 200, body: [{ id: A, status: "error", error_message: "moderation" }, { id: B, status: "complete", audio_url: "https://cdn/b.mp3" }] });
    expect(await getSunoBridgeTask(id)).toMatchObject({ status: "completed", audioUrls: ["https://cdn/b.mp3"], missing: 1 });
    reply = () => ({ status: 200, body: [{ id: A, status: "error", error_message: "moderation" }, { id: B, status: "error" }] });
    expect(await getSunoBridgeTask(id)).toMatchObject({ status: "failed", reason: "配乐生成未成功，请保留原任务供服务端核对" });
    reply = () => ({ status: 200, body: [{ id: A, status: "complete", audio_url: "https://cdn/a.mp3" }] });
    expect((await getSunoBridgeTask(id)).status).toBe("pending");
  });

  it("桥 401/403 提示换 cookie；非 JSON 明确报错", async () => {
    reply = () => ({ status: 401, body: "unauthorized" });
    await expect(getSunoBridgeTask(encodeSunoBridgeTaskId([A]))).rejects.toMatchObject({ code: "rejected", httpStatus: 401, submissionUnknown: false });
    reply = () => ({ status: 200, body: "<html>oops</html>" });
    await expect(getSunoBridgeTask(encodeSunoBridgeTaskId([A]))).rejects.toMatchObject({ code: "invalid_response", submissionUnknown: false });
  });

  const request = { model: "suno-bridge-v6" as const, prompt: "结构要求", style: "弦乐", title: "测试", instrumental: true };

  it("带人声请求不被桥客户端改成纯器乐，中文歌名与歌词保持原样", async () => {
    reply = () => ({ status: 200, body: [{ id: A, status: "submitted" }, { id: B, status: "submitted" }] });
    const style = "王力宏30%與汪蘇瀧70% 風格的中式流行情歌，65 BPM，男声，传统乐器与当代管弦乐";
    await createSunoBridgeTask({ ...request, instrumental: false, title: "别爱我又不想说", prompt: "[Verse]\n你把晚风留在窗外", style });
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ make_instrumental: false, title: "别爱我又不想说", prompt: "[Verse]\n你把晚风留在窗外", tags: style, model: "chirp-hawk" });
  });

  it("混入坏ID或重复ID时拒绝整个句柄，不静默丢掉其中一首", async () => {
    expect(decodeSunoBridgeTaskId(`sunobridge:${A},bad id`)).toBeNull();
    expect(decodeSunoBridgeTaskId(`sunobridge:${A},${A}`)).toBeNull();
    reply = () => ({ status: 200, body: [{ id: A }, { status: "submitted" }] });
    await expect(createSunoBridgeTask(request)).rejects.toMatchObject({ submissionUnknown: true });
    reply = () => ({ status: 200, body: [{ id: A }, { id: A }] });
    await expect(createSunoBridgeTask(request)).rejects.toMatchObject({ submissionUnknown: true });
  });

  it("POST断线、5xx、坏JSON和缺回执均保留未知状态，且绝不自动重试", async () => {
    for (const response of [{ status: 502, body: "upstream lost" }, { status: 200, body: "not json" }, { status: 200, body: [] }]) {
      calls.length = 0;
      reply = () => response;
      const error = await createSunoBridgeTask(request).catch(e => e);
      expect(isSunoBridgeSubmissionUnknown(error)).toBe(true);
      expect(calls).toHaveLength(1);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test-key transport")));
    await expect(createSunoBridgeTask(request)).rejects.toMatchObject({ submissionUnknown: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("明确拒绝与尚未发出的请求不标未知；错误中不夹带桥正文或底层凭证", async () => {
    reply = () => ({ status: 403, body: "Authorization: Bearer test-key; Cookie: test-cookie" });
    const error = await createSunoBridgeTask(request).catch(e => e);
    expect(error).toMatchObject({ httpStatus: 403, submissionUnknown: false });
    expect(error.message).not.toMatch(/test-key|test-cookie|Authorization|Bearer/);
    const controller = new AbortController();
    controller.abort(new Error("test-key"));
    calls.length = 0;
    await expect(createSunoBridgeTask(request, { abortSignal: controller.signal })).rejects.toMatchObject({ submissionUnknown: false });
    expect(calls).toHaveLength(0);
    reply = () => ({ status: 200, body: [{ id: A, status: "error", error_message: "Cookie: test-cookie" }] });
    const failed = await getSunoBridgeTask(encodeSunoBridgeTaskId([A]));
    expect(failed.status).toBe("failed");
    if (failed.status === "failed") expect(failed.reason).not.toContain("test-cookie");
  });
});
