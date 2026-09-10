import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSunoBridgeTask,
  decodeSunoBridgeTaskId,
  encodeSunoBridgeTaskId,
  getSunoBridgeTask,
  isSunoBridgeReady,
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
    process.env.SUNO_BRIDGE_MODEL_V6 = "chirp-fenix";
    expect(resolveSunoBridgeChirpModel("suno-bridge-v6")).toBe("chirp-fenix");
  });

  it("建单：走 /api/custom_generate，纯 BGM 不送歌词，wait_audio=false，返回两条 clip 编成一个 task id", async () => {
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
    expect(body).toMatchObject({ prompt: "", tags: "国风弦乐，战鼓，纯器乐", title: "剧情配乐", make_instrumental: true, model: "chirp-goose", wait_audio: false, negative_tags: "vocals" });
    expect(out.clipIds).toEqual([A, B]);
    expect(out.taskId).toBe(`sunobridge:${A},${B}`);
    expect(out.chirpModel).toBe("chirp-goose");
  });

  it("轮询：两条都 complete 才完成并按原顺序给 audio_url；任一 error 即失败；否则 pending", async () => {
    const id = encodeSunoBridgeTaskId([A, B]);
    reply = () => ({ status: 200, body: [{ id: B, status: "complete", audio_url: "https://cdn/b.mp3" }, { id: A, status: "streaming", audio_url: "https://cdn/a-partial.mp3" }] });
    expect((await getSunoBridgeTask(id)).status).toBe("pending");
    expect(calls.at(-1)!.url).toContain(`/api/get?ids=${encodeURIComponent(`${A},${B}`)}`);
    reply = () => ({ status: 200, body: [{ id: B, status: "complete", audio_url: "https://cdn/b.mp3" }, { id: A, status: "complete", audio_url: "https://cdn/a.mp3" }] });
    const done = await getSunoBridgeTask(id);
    expect(done).toMatchObject({ status: "completed", audioUrls: ["https://cdn/a.mp3", "https://cdn/b.mp3"] });
    reply = () => ({ status: 200, body: [{ id: A, status: "error", error_message: "moderation" }, { id: B, status: "complete", audio_url: "https://cdn/b.mp3" }] });
    expect(await getSunoBridgeTask(id)).toMatchObject({ status: "failed", reason: "moderation" });
  });

  it("桥 401/403 提示换 cookie；非 JSON 明确报错", async () => {
    reply = () => ({ status: 401, body: "unauthorized" });
    await expect(getSunoBridgeTask(encodeSunoBridgeTaskId([A]))).rejects.toThrow(/suno_bridge_failed:401.*cookie/);
    reply = () => ({ status: 200, body: "<html>oops</html>" });
    await expect(getSunoBridgeTask(encodeSunoBridgeTaskId([A]))).rejects.toThrow(/suno_bridge_bad_json/);
  });
});
