import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1110 语音转写通道合规（离线替身，不发真实请求，参照 services/geminiMediaTwoHop.channels.test.ts）：
 * transcribeAudio 先把音频存 GCS，再走 Vertex gs:// → EvoLink 签名 https 两跳；返回 Whisper verbose_json 形状不变。
 */
const h = vi.hoisted(() => ({ upload: vi.fn(), store: new Map<string, { buffer: Buffer; contentType: string }>() }));
vi.mock("../services/vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("../services/gcs", () => ({
  uploadBufferToGcsIfAbsent: h.upload,
  signGsUriV4ReadUrl: (u: string, seconds: number) => `https://signed.example/${u.slice(5)}?X-Goog-Expires=${seconds}&X-Goog-Signature=test`,
  getGcsBucketName: () => "test-bucket",
}));

import { transcribeAudio } from "./voiceTranscription";

const fetchMock = vi.fn();
const geminiReply = (value: unknown) => new Response(JSON.stringify({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
}), { status: 200 });
const modelCalls = () => fetchMock.mock.calls.filter(c => /aiplatform\.googleapis\.com|direct\.evolink\.ai/.test(String(c[0])));
const modelBodies = () => modelCalls().map(c => JSON.parse(String((c[1] as RequestInit).body)));
const transcript = { language: "zh", durationSec: 6.5, text: "大家好。今天讲三点。", segments: [{ startSec: 0, endSec: 2.1, text: "大家好。" }, { startSec: 2.3, endSec: 6.2, text: "今天讲三点。" }] };

const assertTwoHopCompliance = () => {
  const urls = fetchMock.mock.calls.map(c => String(c[0])).join("\n");
  expect(urls).not.toContain("generativelanguage.googleapis.com");
  expect(urls).not.toContain("api.openai.com");
  expect(urls.toLowerCase()).not.toContain("openrouter");
  const wire = [urls, ...fetchMock.mock.calls.map(c => JSON.stringify((c[1] as RequestInit | undefined)?.headers ?? {})), ...modelCalls().map(c => String((c[1] as RequestInit).body))].join("\n");
  for (const key of ["test-direct-gemini-key", "sk-or-test-key", "sk-openai-test-key"]) expect(wire).not.toContain(key);
  for (const call of modelCalls()) {
    const body = String((call[1] as RequestInit).body);
    expect(body).not.toContain("inlineData");
    const fileUri = JSON.parse(body).contents[0].parts[0].fileData.fileUri as string;
    expect(String(call[0])).toContain("gemini-3.8-flash");
    if (String(call[0]).includes("direct.evolink.ai")) expect(fileUri).toMatch(/^https:\/\//);
    else expect(fileUri).toMatch(/^gs:\/\/test-bucket\/voice-transcription\/[0-9a-f]{64}\/audio\.mp3$/);
  }
  const evidence = Array.from(h.store.entries()).filter(([k]) => k.endsWith(".json")).map(([, v]) => v.buffer.toString("utf8")).join("\n");
  expect(evidence).not.toContain("X-Goog-Signature");
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
  vi.stubEnv("OPENAI_API_KEY", "sk-openai-test-key");
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer, contentType }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, { buffer, contentType });
    return { created: true };
  });
});
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("transcribeAudio 两跳", () => {
  it("音轨字节先存 GCS，Vertex 读 gs://；返回 Whisper 形状；raw 与 parsed 分别落档", async () => {
    const bytes = Buffer.from("growth-audio-track");
    const sha = createHash("sha256").update(bytes).digest("hex");
    fetchMock.mockResolvedValueOnce(geminiReply(transcript));
    const result = await transcribeAudio({ audioBuffer: bytes, mimeType: "audio/mpeg", language: "zh", prompt: "请转写口播" });
    expect(result).toEqual({
      task: "transcribe", language: "zh", duration: 6.5, text: "大家好。今天讲三点。",
      segments: [
        { id: 0, seek: 0, start: 0, end: 2.1, text: "大家好。", tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
        { id: 1, seek: 0, start: 2.3, end: 6.2, text: "今天讲三点。", tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
      ],
    });
    const audioObject = `voice-transcription/${sha}/audio.mp3`;
    expect(h.store.get(audioObject)).toEqual({ buffer: bytes, contentType: "audio/mpeg" });
    expect(modelBodies()[0].contents[0].parts[0].fileData).toEqual({ mimeType: "audio/mpeg", fileUri: `gs://test-bucket/${audioObject}` });
    expect(modelBodies()[0].contents[0].parts[1].text).toContain("请转写口播");
    expect(modelBodies()[0].generationConfig).toMatchObject({ audioTimestamp: true, responseSchema: { type: "OBJECT" } });
    // 1110 转写：temperature 0、无字数合同取单次上限 65536（原 32768 会截断长块），并记入 request 证据
    expect(modelBodies()[0].generationConfig).toMatchObject({ temperature: 0, maxOutputTokens: 65_536 });
    const names = Array.from(h.store.keys()).filter(k => k.startsWith(`voice-transcription/${sha}/attempts/`)).map(k => k.replace(/^.*\/attempts\/[^/]+\//, ""));
    expect(names).toEqual(["request.json", "hop-1-vertex-request.json", "hop-1-vertex-raw.json", "hop-1-vertex-decoded.json", "hop-1-vertex-parsed.json", "hop-used.json"]);
    const hopRequest = Array.from(h.store.entries()).find(([k]) => k.endsWith("/hop-1-vertex-request.json"))![1].buffer.toString("utf8");
    expect(JSON.parse(hopRequest)).toMatchObject({ temperature: 0, maxOutputTokens: 65_536, timeoutMs: 240_000 });
    assertTwoHopCompliance();
  });

  it("Vertex 超时 → EvoLink 收签名 https（3600 秒）；旧 audioBase64 入参照收，但在服务端解码后存 GCS", async () => {
    const bytes = Buffer.from("legacy-base64-audio");
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(geminiReply(transcript));
    const result = await transcribeAudio({ audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg" });
    expect("text" in result && result.text).toBe("大家好。今天讲三点。");
    expect(modelCalls().map(c => String(c[0]))).toEqual([
      expect.stringContaining("aiplatform.googleapis.com"),
      "https://direct.evolink.ai/v1beta/models/gemini-3.8-flash:generateContent",
    ]);
    expect(modelBodies()[1].contents[0].parts[0].fileData.fileUri).toMatch(/^https:\/\/signed\.example\/test-bucket\/voice-transcription\/[0-9a-f]{64}\/audio\.mp3\?X-Goog-Expires=3600&/);
    expect(JSON.stringify(modelBodies())).not.toContain(bytes.toString("base64"));
    // Vertex 与 EvoLink 两跳都是 temperature 0 / 65536
    expect(modelBodies().map(b => [b.generationConfig.temperature, b.generationConfig.maxOutputTokens])).toEqual([[0, 65_536], [0, 65_536]]);
    assertTwoHopCompliance();
  });

  it("audioUrl：下载后存 GCS 再走两跳", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(new Uint8Array(Buffer.from("url-audio")), { status: 200, headers: { "content-type": "audio/mpeg" } }))
      .mockResolvedValueOnce(geminiReply(transcript));
    const result = await transcribeAudio({ audioUrl: "https://storage.example/a.mp3" });
    expect("segments" in result && result.segments).toHaveLength(2);
    expect(modelCalls()).toHaveLength(1);
    assertTwoHopCompliance();
  });

  it("两跳都写坏（段时间倒序）→ TRANSCRIPTION_FAILED 错误对象，不抛", async () => {
    fetchMock.mockResolvedValue(geminiReply({ ...transcript, segments: [{ startSec: 3, endSec: 1, text: "x" }] }));
    const result = await transcribeAudio({ audioBuffer: Buffer.from("bad"), mimeType: "audio/mpeg" });
    expect(result).toMatchObject({ code: "TRANSCRIPTION_FAILED", details: expect.stringContaining("全部通道失败") });
    expect(modelCalls()).toHaveLength(2);
    assertTwoHopCompliance();
  });

  it("Vertex / EvoLink 都未配置 → SERVICE_ERROR，不上传、不发请求（不回退任何旧直连密钥）", async () => {
    vi.stubEnv("VERTEX_PROJECT_ID", "");
    vi.stubEnv("EVOLINK_API_KEY", "");
    const result = await transcribeAudio({ audioBuffer: Buffer.from("a"), mimeType: "audio/mpeg" });
    expect(result).toMatchObject({ code: "SERVICE_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("超过 16MB → FILE_TOO_LARGE，不上传", async () => {
    const result = await transcribeAudio({ audioBuffer: Buffer.alloc(16 * 1024 * 1024 + 1), mimeType: "audio/mpeg" });
    expect(result).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("成长营 transcribeVideoAudio 直接交音轨字节，不再转 base64", () => {
    const src = readFileSync(new URL("../growth/analyzeVideo.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("async function transcribeVideoAudio"), src.indexOf("/** 抽帧策略"));
    expect(fn).toContain("audioBuffer,");
    expect(fn).not.toMatch(/audioBase64|toString\("base64"\)/);
  });
});
