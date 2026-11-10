import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 1110 通道合规（离线替身，不发真实请求）：漫剧听音扫描走 Gemini 3.8 Flash 两跳（Vertex gs:// → EvoLink 签名 https），不内联 base64。 */
const h = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), sign: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("./vertexMedia.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./vertexMedia.js")>()),
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("./gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gcs")>();
  return {
    ...actual,
    uploadBufferToGcsIfAbsent: h.upload,
    signGsUriV4ReadUrl: (u: string) => `https://signed.example/${u.slice(5)}?X-Goog-Signature=test`,
    getGcsBucketName: () => "test-bucket",
    downloadGcsObject: async () => { throw new Error("不应再下载 gs:// 转 base64"); },
    // 直传签名走真实 V4 签名（本地运算、不联网），只记参数
    createGcsSignedUploadUrl: (params: Parameters<typeof actual.createGcsSignedUploadUrl>[0]) => {
      h.sign(params);
      return actual.createGcsSignedUploadUrl(params);
    },
  };
});
// 归属核验走真实的后期素材登记逻辑，只替换登记来源（不连库）：用户 7 有一条成功任务产物 canvas-tts/job-1/voice.mp3
vi.mock("./postProdMediaSource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./postProdMediaSource")>();
  return {
    ...actual,
    resolveRegisteredPostProdMediaSource: (input: { userId: string; source: string }) =>
      actual.resolveRegisteredPostProdMediaSource(input, {
        getBucket: () => "test-bucket",
        verifyOwnership: async () => false,
        loadSucceededJobOutputObjects: async () => new Set<string>(),
        loadSucceededJobOutputSources: async (uid: string) => ({ objects: new Set(uid === "7" ? ["canvas-tts/job-1/voice.mp3"] : []), urls: new Set<string>() }),
      }),
  };
});
import handler from "../../api/google";

const SCAN = {
  language: "zh",
  transcriptSummary: "女主当众反击",
  sections: [
    { name: "开场钩子", timeRange: "0:00-0:12", mood: "压抑", energy: "中", lyrics: "" },
    { name: "反转", timeRange: "0:12-0:30", mood: "爽", energy: "极高", lyrics: "你也配？" },
  ],
};
const AUDIO_URL = "https://media.example/learn/ep1.mp3";
const fetchMock = vi.fn();
const geminiReply = () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(SCAN) }] } }] }), { status: 200 });
const modelCalls = () => fetchMock.mock.calls.filter(c => String(c[0]) !== AUDIO_URL);
const sentUrls = () => modelCalls().map(c => String(c[0]));
const sentBodies = () => modelCalls().map(c => String((c[1] as RequestInit).body));
const sentHeaders = () => modelCalls().map(c => JSON.stringify((c[1] as RequestInit).headers));
const uploaded = () => h.upload.mock.calls.map(c => c[0] as { objectName: string; buffer: Buffer; contentType: string });

async function invokeOp(op: string, body: Record<string, unknown>) {
  let status = 0, result: any;
  const response = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { result = value; return this; },
  };
  await handler({ method: "POST", query: { op }, body } as never, response as never);
  return { status, body: result };
}
const invoke = (body: Record<string, unknown>) => invokeOp("manhuaAudioClimaxScan", body);
// 虚构签名身份（本地临时生成，不对应任何真实服务账号）
const FAKE_SIGNER = JSON.stringify({
  client_email: "test-signer@example.invalid",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const assertTwoHopCompliant = () => {
  expect(sentUrls().every(u => !u.includes("generativelanguage.googleapis.com") && !u.includes("openrouter"))).toBe(true);
  expect(sentUrls().every(u => u.includes("models/gemini-3.8-flash:generateContent"))).toBe(true);
  expect(sentUrls().join("\n") + sentHeaders().join("\n")).not.toContain("test-direct-gemini-key");
  expect(sentBodies().join("\n")).not.toContain("inlineData");
};

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.sign.mockReset();
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer, contentType }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, contentType === "application/json" ? JSON.parse(buffer.toString()) : buffer);
    return { created: true };
  });
  fetchMock.mockReset().mockImplementation(async (url: unknown) =>
    String(url) === AUDIO_URL ? new Response(Buffer.from("虚构音频字节"), { status: 200, headers: { "content-type": "audio/mpeg" } }) : geminiReply());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  // 真实 getGcsBucketName（签名函数内部用）与替身同桶，核验侧桶名一致
  vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("本人前缀 gcsUri 直接给 Vertex 读 gs://，不下载不转 base64；输出结构同原函数", async () => {
  const result = await invoke({ gcsUri: "gs://test-bucket/uploads/u7/ep1.mp3", mimeType: "audio/mpeg" });
  expect(result).toEqual({
    status: 200,
    body: {
      ok: true, model: "vertex/gemini-3.8-flash", language: "zh", transcriptSummary: "女主当众反击", via: "gcs",
      sections: [
        { name: "开场钩子", timeRange: "0:00-0:12", mood: "压抑", energy: "中", lyrics: undefined },
        { name: "反转", timeRange: "0:12-0:30", mood: "爽", energy: "极高", lyrics: "你也配？" },
      ],
    },
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(sentUrls()[0]).toContain("https://aiplatform.googleapis.com/");
  const body = JSON.parse(sentBodies()[0]!);
  expect(body.contents[0].parts[0].fileData).toEqual({ mimeType: "audio/mpeg", fileUri: "gs://test-bucket/uploads/u7/ep1.mp3" });
  expect(body.contents[0].parts[1].text).toContain("竖屏短剧/漫剧听写与节奏分析助手");
  expect(body.generationConfig.audioTimestamp).toBe(true);
  expect(body.generationConfig.responseSchema.required).toEqual(["language", "transcriptSummary", "sections"]);
  assertTwoHopCompliant();
  // 只落 JSON 证据（本人前缀），不转存媒体；原始回包与解析结果分开存
  expect(uploaded().every(u => u.contentType === "application/json" && /^manhua-template-learn\/audio-scan\/7\/[0-9a-f-]{36}\//.test(u.objectName))).toBe(true);
  const names = uploaded().map(u => u.objectName.replace(/^.*\/[0-9a-f-]{36}\//, ""));
  expect(names).toEqual(expect.arrayContaining(["request.json", "hop-1-vertex-request.json", "hop-1-vertex-raw.json", "hop-1-vertex-decoded.json", "hop-1-vertex-parsed.json", "scan.json"]));
});

it("只有 audioUrl：Fly 代下后存到本人前缀 GCS；Vertex 失败时 EvoLink 收签名 https（不收 gs://）", async () => {
  fetchMock.mockImplementation(async (url: unknown) => {
    if (String(url) === AUDIO_URL) return new Response(Buffer.from("虚构音频字节"), { status: 200 });
    return String(url).includes("aiplatform") ? new Response("{}", { status: 503 }) : geminiReply();
  });
  const result = await invoke({ audioUrl: AUDIO_URL });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ ok: true, model: "evolink/gemini-3.8-flash", language: "zh", via: "audioUrl" });
  expect(result.body.sections).toHaveLength(2);
  const media = uploaded().find(u => u.contentType === "audio/mpeg")!;
  expect(media.objectName).toMatch(/^manhua-template-learn\/audio-scan\/7\/[0-9a-f-]{36}\/source\.mp3$/);
  expect(media.buffer.toString()).toBe("虚构音频字节");
  expect(sentBodies()).toHaveLength(2);
  expect(sentBodies()[0]).toContain(`"fileUri":"gs://test-bucket/${media.objectName}"`);
  expect(sentBodies()[1]).toContain(`"fileUri":"https://signed.example/test-bucket/${media.objectName}`);
  expect(sentBodies()[1]).not.toContain("gs://");
  expect(sentUrls()[1]).toContain("/v1beta/models/gemini-3.8-flash:generateContent");
  assertTwoHopCompliant();
  // 证据只记 gs://，不记签名链接
  const evidence = JSON.stringify(Array.from(h.store.entries()).filter(([n]) => n.endsWith(".json")));
  expect(evidence).not.toContain("https://signed.example");
  expect(evidence).toContain(`gs://test-bucket/${media.objectName}`);
});

it("两跳都失败时报错且不回退 OpenRouter / 直连 key", async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
  const result = await invoke({ gcsUri: "gs://test-bucket/uploads/u7/a.mp3" });
  expect(result.status).toBe(500);
  expect(result.body.error).toBe("manhua_audio_scan_failed");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  assertTwoHopCompliant();
});

it("未登录或 gcsUri 非 gs:// 时不访问模型", async () => {
  h.auth.mockResolvedValueOnce(null);
  expect((await invoke({ gcsUri: "gs://test-bucket/a.mp3" })).status).toBe(401);
  expect((await invoke({ gcsUri: "https://x/a.mp3" })).status).toBe(400);
  expect((await invoke({})).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});

it("gcsUri 只收本人对象：别人前缀、别的桶、未登记、越界路径一律 403，模型零调用、不下载、不落档", async () => {
  for (const gcsUri of [
    "gs://test-bucket/uploads/u8/a.mp3",
    "gs://other-bucket/uploads/u7/a.mp3",
    "gs://test-bucket/manhua-template-learn/123-ep1.mp3",
    "gs://test-bucket/uploads/u7/../u8/a.mp3",
  ]) {
    const result = await invoke({ gcsUri });
    expect(result.status, gcsUri).toBe(403);
    expect(result.body.error).toBe("gcs_uri_not_allowed");
  }
  h.auth.mockResolvedValue({ id: 8, role: "user" });
  expect((await invoke({ gcsUri: "gs://test-bucket/canvas-tts/job-1/voice.mp3" })).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});

it("本人其他登记对象（成功任务产物）同样放行，正常两跳", async () => {
  const result = await invoke({ gcsUri: "gs://test-bucket/canvas-tts/job-1/voice.mp3" });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ ok: true, model: "vertex/gemini-3.8-flash", via: "gcs" });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(sentBodies()[0]).toContain('"fileUri":"gs://test-bucket/canvas-tts/job-1/voice.mp3"');
  assertTwoHopCompliant();
});

// ---------------- 学习直传签名（听音 / 读帧）：须登录；对象落本人前缀；上传后的对象过听音扫描归属核验 ----------------
const UPLOAD_OPS = [
  { op: "manhuaAudioGetUploadUrl", subdir: "manhua-template-learn", body: { fileName: "ep1.mp3", mimeType: "audio/mpeg" } },
  { op: "manhuaTemplateFrameGetUploadUrl", subdir: "manhua-template-learn/frames", body: { fileName: "f1.jpg", mimeType: "image/jpeg" } },
] as const;

it("学习直传签名：未登录一律 401，不签名、不落档", async () => {
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", FAKE_SIGNER);
  for (const { op, body } of UPLOAD_OPS) {
    h.auth.mockResolvedValueOnce(null);
    expect(await invokeOp(op, body), op).toEqual({
      status: 401,
      body: { ok: false, error: "authentication_required", message: "请先登录后再上传文件" },
    });
    h.auth.mockRejectedValueOnce(new Error("session expired"));
    expect((await invokeOp(op, body)).status, op).toBe(401);
  }
  expect(h.sign).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});

it("学习直传签名：对象名由服务端生成并落本人前缀 uploads/u<uid>/，客户端 objectName/越界文件名无效；Content-Type 签入、有效期仍 20 分钟", async () => {
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", FAKE_SIGNER);
  for (const { op, subdir, body } of UPLOAD_OPS) {
    h.sign.mockClear();
    const result = await invokeOp(op, { ...body, objectName: "uploads/u8/hijack.bin", fileName: `../../u8/${body.fileName}` });
    expect(result.status, op).toBe(200);
    const prefix = `uploads/u7/${subdir}/`;
    const objectName = String(result.body.objectName);
    expect(objectName.startsWith(prefix), objectName).toBe(true);
    expect(objectName.slice(prefix.length)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[\w.-]+$/);
    expect(objectName).not.toContain("..");
    expect(result.body).toMatchObject({ ok: true, bucket: "test-bucket", gcsUri: `gs://test-bucket/${objectName}`, mimeType: body.mimeType });
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.sign.mock.calls[0]![0]).toMatchObject({ contentType: body.mimeType, expiresInMinutes: 20 });
    const url = new URL(result.body.uploadUrl);
    expect(url.pathname).toBe(`/test-bucket/${objectName}`);
    expect(url.searchParams.get("X-Goog-Expires")).toBe("1200");
    expect(url.searchParams.get("X-Goog-SignedHeaders")).toBe("content-type;host");
  }
  // 换人登录，前缀随之换成本人
  h.auth.mockResolvedValue({ id: 8, role: "user" });
  expect((await invokeOp("manhuaAudioGetUploadUrl", {})).body.objectName).toMatch(/^uploads\/u8\/manhua-template-learn\/[0-9a-f-]{36}-learn-audio\.mp3$/);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});

it("经学习直传拿到的 gcsUri 能过听音扫描归属核验（本人放行、正常两跳）；换别人拿去仍 403", async () => {
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", FAKE_SIGNER);
  // 文件名含中文与连续点：落点规整后不含 ".."，核验侧不会按越界路径拒收
  const issued = await invokeOp("manhuaAudioGetUploadUrl", { fileName: "第1集 原声..mp3", mimeType: "audio/mpeg" });
  expect(issued.status).toBe(200);
  const gcsUri = String(issued.body.gcsUri);
  expect(gcsUri).toMatch(/^gs:\/\/test-bucket\/uploads\/u7\/manhua-template-learn\//);
  const scan = await invoke({ gcsUri, mimeType: "audio/mpeg" });
  expect(scan.status).toBe(200);
  expect(scan.body).toMatchObject({ ok: true, model: "vertex/gemini-3.8-flash", via: "gcs" });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.parse(sentBodies()[0]!).contents[0].parts[0].fileData).toEqual({ mimeType: "audio/mpeg", fileUri: gcsUri });
  assertTwoHopCompliant();

  fetchMock.mockClear();
  h.upload.mockClear();
  h.auth.mockResolvedValue({ id: 8, role: "user" });
  const stolen = await invoke({ gcsUri, mimeType: "audio/mpeg" });
  expect(stolen.status).toBe(403);
  expect(stolen.body.error).toBe("gcs_uri_not_allowed");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});
