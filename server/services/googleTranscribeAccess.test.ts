import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: auth } }));
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
      candidates: [{ finishReason, content: { parts: [{ text }] } }],
    }),
    { status: 200 }
  );
}
beforeEach(() => {
  auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  upstream.mockReset().mockResolvedValue(completed());
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("只允许已登录用户POST，拒绝时不访问模型", async () => {
  expect((await invoke(valid, "GET")).status).toBe(405);
  auth.mockResolvedValueOnce(null);
  expect((await invoke()).status).toBe(401);
  auth.mockRejectedValueOnce(new Error("测试过期登录态"));
  expect((await invoke()).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});
it("服务端拒绝未知MIME、缺音频和损坏base64，不依赖客户端限制", async () => {
  expect((await invoke({ ...valid, mimeType: "video/mp4" })).status).toBe(415);
  expect((await invoke({ ...valid, audioBase64: "" })).status).toBe(400);
  for (const audioBase64 of ["%%%%", "dGVzdA", "AA==\n", "A===", "AB=="])
    expect((await invoke({ ...valid, audioBase64 })).body.error).toBe(
      "invalid_audio_base64"
    );
  expect(upstream).not.toHaveBeenCalled();
});
it("8MB边界允许，超过8MB在上游调用前拒绝", async () => {
  const audioBase64 = "A".repeat(Math.ceil((8 * 1024 * 1024 + 1) / 3) * 4);
  expect((await invoke({ ...valid, audioBase64 })).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
  const exact = Buffer.alloc(8 * 1024 * 1024).toString("base64");
  expect((await invoke({ ...valid, audioBase64: exact })).status).toBe(200);
  expect(upstream).toHaveBeenCalledOnce();
});
it("保留原模型参数和旧{text}消费者合同，单次调用不重试", async () => {
  const result = await invoke();
  expect(result).toEqual({
    status: 200,
    body: { ok: true, text: "测试识别全文" },
  });
  expect(upstream).toHaveBeenCalledOnce();
  const [url, options] = upstream.mock.calls[0];
  expect(url).toContain("models/gemini-3.1-flash-lite-preview:generateContent");
  expect(JSON.parse(options.body)).toMatchObject({
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    contents: [
      {
        parts: [
          { text: expect.any(String) },
          { inlineData: { mimeType: "audio/webm", data: valid.audioBase64 } },
        ],
      },
    ],
  });
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
it("被截断、被阻止及空白结果明确失败，不冒充完整转写", async () => {
  for (const finish of ["MAX_TOKENS", "SAFETY", "OTHER"]) {
    upstream.mockResolvedValueOnce(completed("前半段", finish));
    const result = await invoke();
    expect(result.status).toBe(422);
    expect(result.body).not.toHaveProperty("text");
  }
  for (const text of [" ", "字".repeat(12_001)]) {
    upstream.mockResolvedValueOnce(completed(text));
    expect((await invoke()).body.error).toBe("transcription_unusable");
  }
});
it("上游失败只返回脱敏错误，不传播模型密钥或自动重试", async () => {
  upstream.mockResolvedValueOnce(
    new Response("上游错误 test-key", { status: 429 })
  );
  expect(await invoke()).toMatchObject({
    status: 502,
    body: { ok: false, error: "transcription_upstream_failed" },
  });
  upstream.mockRejectedValueOnce(
    new Error("https://example.invalid/?key=test-key")
  );
  const result = await invoke();
  expect(result.status).toBe(502);
  expect(JSON.stringify(result.body)).not.toContain("test-key");
  expect(upstream).toHaveBeenCalledTimes(2);
});
