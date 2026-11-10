import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 1110 通道合规（离线替身，不发真实请求）：语音转写先存本人前缀 GCS，再走 Gemini 3.8 Flash 两跳（Vertex gs:// → EvoLink 签名 https）。 */
const h = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("./vertexMedia.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./vertexMedia.js")>()),
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("./gcs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gcs")>()),
  uploadBufferToGcsIfAbsent: h.upload,
  signGsUriV4ReadUrl: (u: string) => `https://signed.example/${u.slice(5)}?X-Goog-Signature=test`,
  getGcsBucketName: () => "test-bucket",
}));
import handler from "../../api/google";

const upstream = vi.fn();
const valid = {
  audioBase64:
    Buffer.from("虚构音频字节，仅测试网关，不调用模型").toString("base64"),
  mimeType: "audio/webm;codecs=opus",
};
async function invoke(body: Record<string, unknown> = valid, method = "POST") {
  let status = 0,
    result: any;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      result = value;
      return this;
    },
  };
  await handler(
    { method, query: { op: "transcribeAudio" }, body } as never,
    response as never
  );
  return { status, body: result };
}
function completed(text = "测试识别全文", finishReason = "STOP") {
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ text }) }] } }],
    }),
    { status: 200 }
  );
}
const sentUrls = () => upstream.mock.calls.map(c => String(c[0]));
const sentBodies = () => upstream.mock.calls.map(c => String((c[1] as RequestInit).body));
const sentHeaders = () => upstream.mock.calls.map(c => JSON.stringify((c[1] as RequestInit).headers));
const uploaded = () => h.upload.mock.calls.map(c => c[0] as { objectName: string; buffer: Buffer; contentType: string });
const assertTwoHopCompliant = () => {
  expect(sentUrls().every(u => !u.includes("generativelanguage.googleapis.com") && !u.includes("openrouter"))).toBe(true);
  expect(sentUrls().every(u => u.includes("models/gemini-3.8-flash:generateContent"))).toBe(true);
  expect(sentUrls().join("\n") + sentHeaders().join("\n")).not.toContain("test-direct-gemini-key");
  expect(sentBodies().join("\n")).not.toContain("inlineData");
  expect(sentBodies().join("\n")).not.toContain(valid.audioBase64);
};
beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer, contentType }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, contentType === "application/json" ? JSON.parse(buffer.toString()) : buffer);
    return { created: true };
  });
  upstream.mockReset().mockImplementation(async () => completed());
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("只允许已登录用户POST，拒绝时不访问模型", async () => {
  expect((await invoke(valid, "GET")).status).toBe(405);
  h.auth.mockResolvedValueOnce(null);
  expect((await invoke()).status).toBe(401);
  h.auth.mockRejectedValueOnce(new Error("测试过期登录态"));
  expect((await invoke()).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});
it("服务端拒绝未知MIME、缺音频和损坏base64，不依赖客户端限制", async () => {
  expect((await invoke({ ...valid, mimeType: "video/mp4" })).status).toBe(415);
  expect((await invoke({ ...valid, audioBase64: "" })).status).toBe(400);
  for (const audioBase64 of ["%%%%", "dGVzdA", "AA==\n", "A===", "AB=="])
    expect((await invoke({ ...valid, audioBase64 })).body.error).toBe(
      "invalid_audio_base64"
    );
  expect(upstream).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});
it("8MB边界允许，超过8MB在上游调用前拒绝", async () => {
  const audioBase64 = "A".repeat(Math.ceil((8 * 1024 * 1024 + 1) / 3) * 4);
  expect((await invoke({ ...valid, audioBase64 })).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
  const exact = Buffer.alloc(8 * 1024 * 1024).toString("base64");
  expect((await invoke({ ...valid, audioBase64: exact })).status).toBe(200);
  expect(upstream).toHaveBeenCalledOnce();
});
it("音频先存本人前缀GCS，Vertex读gs://（gemini-3.8-flash），不直连key、无inlineData，返回旧{text}合同", async () => {
  const result = await invoke();
  expect(result).toEqual({ status: 200, body: { ok: true, text: "测试识别全文" } });
  const audio = uploaded().find(u => u.contentType === "audio/webm")!;
  expect(audio.objectName).toMatch(/^voice-transcribe\/7\/[0-9a-f-]{36}\/audio\.webm$/);
  expect(audio.buffer.equals(Buffer.from(valid.audioBase64, "base64"))).toBe(true);
  expect(upstream).toHaveBeenCalledOnce();
  expect(sentUrls()[0]).toContain("https://aiplatform.googleapis.com/");
  const body = JSON.parse(sentBodies()[0]!);
  expect(body.contents[0].parts[0].fileData).toEqual({ mimeType: "audio/webm", fileUri: `gs://test-bucket/${audio.objectName}` });
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  // 1110 转写：temperature 0；上限按 12000 字合同估算（12000 + 64 + 思考预留 8192 → 20480），不是缺省 8192
  expect(body.generationConfig).toMatchObject({ temperature: 0, maxOutputTokens: 20_480 });
  assertTwoHopCompliant();
  // 原始回包与解析结果分别永久留证；证据只记 gs://，不记签名链接
  const prefix = audio.objectName.replace(/audio\.webm$/, "");
  const names = uploaded().map(u => u.objectName).filter(n => n.startsWith(prefix)).map(n => n.slice(prefix.length));
  expect(names).toEqual(expect.arrayContaining(["request.json", "hop-1-vertex-request.json", "hop-1-vertex-raw.json", "hop-1-vertex-decoded.json", "hop-1-vertex-parsed.json", "transcript.json"]));
  expect(JSON.stringify(Array.from(h.store.entries()).filter(([n]) => n.endsWith(".json")))).not.toContain("https://signed.example");
  expect((h.store.get(`${prefix}request.json`) as any).audioGsUri).toBe(`gs://test-bucket/${audio.objectName}`);
});
it("Vertex失败后EvoLink收到签名https（不收gs://），仍返回{text}", async () => {
  upstream.mockImplementationOnce(async () => new Response("{}", { status: 503 }));
  const result = await invoke();
  expect(result).toEqual({ status: 200, body: { ok: true, text: "测试识别全文" } });
  expect(upstream).toHaveBeenCalledTimes(2);
  expect(sentUrls()[0]).toContain("aiplatform.googleapis.com");
  expect(sentBodies()[0]).toMatch(/"fileUri":"gs:\/\/test-bucket\/voice-transcribe\/7\//);
  expect(sentBodies()[1]).toMatch(/"fileUri":"https:\/\/signed\.example\/test-bucket\/voice-transcribe\/7\//);
  expect(sentBodies()[1]).not.toContain("gs://");
  // Vertex 与 EvoLink 两跳都是 temperature 0 / 20480，两跳 request 证据同记
  expect(sentBodies().map(b => JSON.parse(b).generationConfig).map(c => [c.temperature, c.maxOutputTokens])).toEqual([[0, 20_480], [0, 20_480]]);
  const hopRequests = Array.from(h.store.entries()).filter(([n]) => /\/hop-[12]-(vertex|evolink)-request\.json$/.test(n)).map(([, v]) => v as any);
  expect(hopRequests.map(v => [v.channel, v.temperature, v.maxOutputTokens])).toEqual([["Vertex", 0, 20_480], ["EvoLink", 0, 20_480]]);
  assertTwoHopCompliant();
});
it("被截断、被阻止及空白结果明确失败，不冒充完整转写", async () => {
  for (const finish of ["MAX_TOKENS", "SAFETY", "OTHER"]) {
    upstream.mockImplementation(async () => completed("前半段", finish));
    const result = await invoke();
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("transcription_incomplete");
    expect(result.body).not.toHaveProperty("text");
  }
  for (const text of [" ", "字".repeat(12_001)]) {
    upstream.mockImplementation(async () => completed(text));
    expect((await invoke()).body.error).toBe("transcription_unusable");
  }
});
it("两跳都失败只返回脱敏错误，每跳至多一次、不自动重试", async () => {
  upstream.mockImplementation(async () => new Response("上游错误 test-direct-gemini-key", { status: 429 }));
  expect(await invoke()).toMatchObject({
    status: 502,
    body: { ok: false, error: "transcription_upstream_failed" },
  });
  expect(upstream).toHaveBeenCalledTimes(2);
  upstream.mockReset().mockRejectedValue(new Error("https://example.invalid/?key=test-direct-gemini-key"));
  const result = await invoke();
  expect(result.status).toBe(502);
  expect(JSON.stringify(result.body)).not.toContain("test-direct-gemini-key");
  expect(upstream).toHaveBeenCalledTimes(2);
  assertTwoHopCompliant();
});
it("Vertex与EvoLink都未配置时不转存、不访问模型（不回退直连key）", async () => {
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
  vi.stubEnv("EVOLINK_API_KEY", "");
  const result = await invoke();
  expect(result.status).toBe(500);
  expect(result.body.error).toBe("missing_env");
  expect(upstream).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});
