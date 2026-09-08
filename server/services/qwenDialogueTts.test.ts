import { afterEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ upload: vi.fn(), inspect: vi.fn() }));
vi.mock("./gcs.js", () => ({ uploadBufferToGcs: io.upload, signGsUriV4ReadUrl: () => "https://example.invalid/signed" }));
vi.mock("./tokenPlanDialogueTts.js", () => ({ inspectTokenPlanDialogueAudio: io.inspect }));
import { synthesizeQwenDialogue } from "./qwenDialogueTts";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("逐句兜底配音流式边界", () => {
  it("时限覆盖请求与上传，正文仍只有既有五字段", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4])));
    vi.stubGlobal("fetch", fetch);
    io.inspect.mockResolvedValue({ accepted: true, durationSeconds: 2, voicedSeconds: 1 });
    io.upload.mockResolvedValue({ gcsUri: "gs://test/audio.mp3" });
    const signal = new AbortController().signal;
    const result = await synthesizeQwenDialogue({ input: "[calm]别怕。", voice: "test-voice", seed: 4, signal });
    expect(result.bytes).toBe(4);
    const options = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(options.signal).toBe(signal);
    expect(Object.keys(JSON.parse(String(options.body))).sort()).toEqual(["input", "model", "response_format", "seed", "voice"]);
    expect(io.upload).toHaveBeenCalledWith(expect.objectContaining({ signal, buffer: Buffer.from([1, 2, 3, 4]) }));
  });
  it("超大响应在读取前拒绝，不验声、不上传", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { headers: { "content-length": String(33 * 1024 * 1024) } })));
    await expect(synthesizeQwenDialogue({ input: "台词", voice: "test-voice" })).rejects.toThrow("上限");
    expect(io.inspect).not.toHaveBeenCalled();
    expect(io.upload).not.toHaveBeenCalled();
  });
});
