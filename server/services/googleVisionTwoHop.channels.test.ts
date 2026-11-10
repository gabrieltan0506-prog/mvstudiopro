import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1110 通道合规（离线替身，不发真实请求）：api/google.ts 的看图类入口
 * canvasVisionMarkdown / videoReversePrompt / manhuaClipQualityReview 一律「媒体先存 GCS → Gemini 两跳
 * （Vertex gs:// → EvoLink 签名 https）」：不打 generativelanguage、不带 Gemini 直连密钥、请求体无 inlineData；
 * 模型经 shared/geminiModelConfig.ts 解析（缺省 gemini-3.8-flash，不收前端传的模型名）；证据只记 gs://。
 */
const h = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("../utils/vertex", () => ({ getVertexAccessToken: async () => "vertex-test-token" }));
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
  downloadGcsObject: async () => { throw new Error("不应下载 gs:// 转 base64"); },
}));
// 归属核验走真实的后期素材登记逻辑，只替换登记来源（不连库）
vi.mock("./postProdMediaSource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./postProdMediaSource")>();
  return {
    ...actual,
    resolveRegisteredPostProdMediaSource: (input: { userId: string; source: string }) =>
      actual.resolveRegisteredPostProdMediaSource(input, {
        getBucket: () => "test-bucket",
        verifyOwnership: async () => false,
        loadSucceededJobOutputObjects: async () => new Set<string>(),
        loadSucceededJobOutputSources: async () => ({ objects: new Set<string>(), urls: new Set<string>() }),
      }),
  };
});
import handler from "../../api/google";

const IMAGE_URL = "https://media.example/canvas/ref.png?token=caller-secret";
const VIDEO_URL = "https://media.example/clips/shot1.mp4";
const QUALITY_OK = [
  "CHARACTER_MATCH=YES", "SCENE_MATCH=YES", "PLOT_MATCH=YES", "CAMERA_MOTION=YES",
  "LIGHTING=YES", "DURATION_OK=YES", "NO_UNRELATED_CONTENT=YES", "SUMMARY=全部通过",
].join("\n");

const fetchMock = vi.fn();
const isMediaUrl = (u: string) => u.startsWith("https://media.example/");
const modelCalls = () => fetchMock.mock.calls.filter(c => !isMediaUrl(String(c[0])));
const sentUrls = () => modelCalls().map(c => String(c[0]));
const sentBodies = () => modelCalls().map(c => String((c[1] as RequestInit).body));
const sentHeaders = () => modelCalls().map(c => JSON.stringify((c[1] as RequestInit).headers));
const uploaded = () => h.upload.mock.calls.map(c => c[0] as { objectName: string; buffer: Buffer; contentType: string });
const evidence = () => JSON.stringify(Array.from(h.store.entries()).filter(([n]) => n.endsWith(".json")));
const geminiReply = (markdown: string) =>
  new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ markdown }) }] } }] }), { status: 200 });
const mediaReply = (url: string) =>
  url.endsWith(".mp4")
    ? new Response(Buffer.from("虚构视频字节"), { status: 200, headers: { "content-type": "video/mp4" } })
    : new Response(Buffer.from("虚构图片字节"), { status: 200, headers: { "content-type": "image/png" } });

async function invoke(op: string, body: Record<string, unknown>) {
  let status = 0, result: any;
  const response = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { result = value; return this; },
  };
  await handler({ method: "POST", query: { op }, body } as never, response as never);
  return { status, body: result };
}

const assertTwoHopCompliant = (model = "gemini-3.8-flash") => {
  expect(sentUrls().length).toBeGreaterThan(0);
  expect(sentUrls().every(u => !u.includes("generativelanguage.googleapis.com") && !u.includes("openrouter"))).toBe(true);
  expect(sentUrls().every(u => u.includes(`models/${model}:generateContent`))).toBe(true);
  expect(sentUrls().join("\n") + sentHeaders().join("\n") + sentBodies().join("\n")).not.toContain("test-direct-gemini-key");
  expect(sentBodies().join("\n")).not.toContain("inlineData");
  expect(sentBodies().join("\n")).not.toContain("base64");
};

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer, contentType }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, contentType === "application/json" ? JSON.parse(buffer.toString()) : buffer);
    return { created: true };
  });
  fetchMock.mockReset().mockImplementation(async (url: unknown) =>
    isMediaUrl(String(url)) ? mediaReply(String(url)) : geminiReply("## 分析\n- 画面：雨夜街头"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
  vi.stubEnv("CANVAS_VISION_MODEL", "");
  vi.stubEnv("MANHUA_CLIP_QUALITY_MODEL", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("canvasVisionMarkdown", () => {
  it("本人 gs:// 直接给 Vertex；https 图下载后存本人前缀 GCS；全是 fileData，不收前端模型名", async () => {
    const result = await invoke("canvasVisionMarkdown", {
      prompt: "整理两张图的人物与场景",
      model: "gemini-3.1-pro-preview",
      images: [{ url: "", gcsUri: "gs://test-bucket/uploads/u7/a.png", mimeType: "image/png" }, { url: IMAGE_URL }],
    });
    expect(result).toEqual({ status: 200, body: { ok: true, markdown: "## 分析\n- 画面：雨夜街头", imageCount: 2 } });
    expect(sentUrls()).toHaveLength(1);
    expect(sentUrls()[0]).toContain("https://aiplatform.googleapis.com/");
    const staged = uploaded().find(u => !u.contentType.includes("json"))!;
    expect(staged.objectName).toMatch(/^canvas-vision\/markdown\/7\/[0-9a-f-]{36}\/media-02\.png$/);
    expect(staged.buffer.toString()).toBe("虚构图片字节");
    const body = JSON.parse(sentBodies()[0]!);
    const parts = body.contents[0].parts;
    expect(parts[0].fileData).toEqual({ mimeType: "image/png", fileUri: "gs://test-bucket/uploads/u7/a.png" });
    expect(parts[1].fileData).toEqual({ mimeType: "image/png", fileUri: `gs://test-bucket/${staged.objectName}` });
    expect(parts[2].text).toContain("整理两张图的人物与场景");
    expect(parts[2].text).toContain("markdown 字段");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 65536 });
    expect(body.generationConfig.responseSchema.required).toEqual(["markdown"]);
    assertTwoHopCompliant();
    // 原始回包与解析结果分开永久落证据；证据只记 gs://，不记签名链接或调用方原链接（可能带令牌）
    const names = uploaded().filter(u => u.contentType === "application/json").map(u => u.objectName.replace(/^.*\/[0-9a-f-]{36}\//, ""));
    expect(names).toEqual(expect.arrayContaining(["request.json", "hop-1-vertex-request.json", "hop-1-vertex-raw.json", "hop-1-vertex-decoded.json", "hop-1-vertex-parsed.json", "hop-used.json"]));
    expect(evidence()).toContain("gs://test-bucket/uploads/u7/a.png");
    expect(evidence()).not.toContain("https://signed.example");
    expect(evidence()).not.toContain("caller-secret");
  });

  it("模型可经 env 换（CANVAS_VISION_MODEL），不写死", async () => {
    vi.stubEnv("CANVAS_VISION_MODEL", "gemini-3.9-flash");
    const result = await invoke("canvasVisionMarkdown", { prompt: "看图", images: [{ url: IMAGE_URL }] });
    expect(result.status).toBe(200);
    assertTwoHopCompliant("gemini-3.9-flash");
  });

  it("gs:// 不是本人对象且无链接：403，不调模型、不落档", async () => {
    const result = await invoke("canvasVisionMarkdown", { prompt: "看图", images: [{ url: "", gcsUri: "gs://test-bucket/uploads/u8/x.png" }] });
    expect(result).toMatchObject({ status: 403, body: { ok: false, error: "gcs_uri_not_allowed" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("两跳都失败：502 业务文案，不回传上游原文，不回落直连 / OpenRouter", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      isMediaUrl(String(url)) ? mediaReply(String(url)) : new Response(JSON.stringify({ error: { message: "upstream detail" } }), { status: 503 }));
    const result = await invoke("canvasVisionMarkdown", { prompt: "看图", images: [{ url: IMAGE_URL }] });
    expect(result).toEqual({ status: 502, body: { ok: false, error: "vision_failed", message: "图片分析暂不可用，请稍后重试" } });
    expect(sentUrls()).toHaveLength(2);
    assertTwoHopCompliant();
    expect(Array.from(h.store.keys()).some(n => n.endsWith("/hop-exhausted.json"))).toBe(true);
  });
});

describe("videoReversePrompt", () => {
  it("前端抽帧 data: 解码后存 GCS；Vertex 失败时 EvoLink 收签名 https（不收 gs://），帧序标签保留", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("aiplatform") ? new Response("{}", { status: 503 }) : geminiReply("| 镜 | 画面 |\n|---|---|\n| 1 | 雨夜 |"));
    const frame = (text: string) => `data:image/jpeg;base64,${Buffer.from(text).toString("base64")}`;
    const result = await invoke("videoReversePrompt", {
      userHint: "反推分镜",
      model: "gemini-3.1-pro-preview",
      images: [{ url: frame("帧一字节"), mimeType: "image/jpeg" }, { url: frame("帧二字节"), mimeType: "image/jpeg" }],
    });
    expect(result).toEqual({ status: 200, body: { ok: true, markdown: "| 镜 | 画面 |\n|---|---|\n| 1 | 雨夜 |", frameCount: 2 } });
    const frames = uploaded().filter(u => u.contentType === "image/jpeg");
    expect(frames.map(f => f.objectName.replace(/^.*\//, ""))).toEqual(["media-01.jpg", "media-02.jpg"]);
    expect(frames.map(f => f.buffer.toString())).toEqual(["帧一字节", "帧二字节"]);
    expect(frames.every(f => /^canvas-vision\/video-reverse\/7\/[0-9a-f-]{36}\//.test(f.objectName))).toBe(true);
    expect(sentUrls()).toHaveLength(2);
    expect(sentUrls()[1]).toBe("https://direct.evolink.ai/v1beta/models/gemini-3.8-flash:generateContent");
    const evo = JSON.parse(sentBodies()[1]!);
    const parts = evo.contents[0].parts;
    expect(parts.map((p: any) => p.text ?? p.fileData?.fileUri.replace(/\?.*$/, ""))).toEqual([
      "帧 1/2", `https://signed.example/test-bucket/${frames[0]!.objectName}`,
      "帧 2/2", `https://signed.example/test-bucket/${frames[1]!.objectName}`,
      expect.stringContaining("（共 2 帧，按时间顺序）"),
    ]);
    expect(sentBodies()[1]).not.toContain("gs://");
    expect(sentBodies()[0]).toContain(`"fileUri":"gs://test-bucket/${frames[0]!.objectName}"`);
    expect(evo.generationConfig).toMatchObject({ temperature: 0.35, maxOutputTokens: 65536 });
    assertTwoHopCompliant();
    expect(evidence()).not.toContain("https://signed.example");
    expect(evidence()).not.toContain("data:image");
  });

  it("坏 data: URL → 400 bad_data_url，不调模型", async () => {
    const result = await invoke("videoReversePrompt", { images: [{ url: "data:image/jpeg;base64" }] });
    expect(result).toMatchObject({ status: 400, body: { error: "bad_data_url" } });
    expect(modelCalls()).toHaveLength(0);
  });
});

describe("manhuaClipQualityReview", () => {
  it("首镜图 + 成片都存 GCS 后按序引用；质检项缺失算写坏换 EvoLink，结果照常解析", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (isMediaUrl(String(url))) return mediaReply(String(url));
      return String(url).includes("aiplatform") ? geminiReply("CHARACTER_MATCH=YES\nSUMMARY=半截") : geminiReply(QUALITY_OK);
    });
    const result = await invoke("manhuaClipQualityReview", {
      referenceImageUrl: IMAGE_URL, videoUrl: VIDEO_URL, expectedContext: "女主推门", expectedDurationSec: 5, shotIndex: 2,
    });
    expect(result.status).toBe(200);
    expect(result.body.report).toMatchObject({ status: "passed", failedKeys: [], summary: "全部通过" });
    expect(result.body.media).toEqual({ imageBytes: Buffer.byteLength("虚构图片字节"), videoBytes: Buffer.byteLength("虚构视频字节") });
    const image = uploaded().find(u => u.contentType === "image/png")!;
    const video = uploaded().find(u => u.contentType === "video/mp4")!;
    expect(image.objectName).toMatch(/^manhua-clip-quality\/7\/[0-9a-f-]{36}\/media-01\.png$/);
    expect(video.objectName).toMatch(/^manhua-clip-quality\/7\/[0-9a-f-]{36}\/media-02\.mp4$/);
    const vertexParts = JSON.parse(sentBodies()[0]!).contents[0].parts;
    expect(vertexParts.slice(0, 4)).toEqual([
      { text: "第1项：本镜关键静帧" }, { fileData: { mimeType: "image/png", fileUri: `gs://test-bucket/${image.objectName}` } },
      { text: "第2项：本镜生成成片" }, { fileData: { mimeType: "video/mp4", fileUri: `gs://test-bucket/${video.objectName}` } },
    ]);
    expect(vertexParts[4].text).toContain("第 2 镜片段");
    expect(sentUrls()[1]).toContain("direct.evolink.ai");
    assertTwoHopCompliant();
    expect(Array.from(h.store.keys()).some(n => n.endsWith("/hop-1-vertex-rejected.json"))).toBe(true);
    expect(Array.from(h.store.keys()).some(n => n.endsWith("/hop-2-evolink-parsed.json"))).toBe(true);
  });

  it("视频拉取失败 → 502 quality_media_fetch_failed，不调模型", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url) === VIDEO_URL ? new Response("", { status: 404 }) : isMediaUrl(String(url)) ? mediaReply(String(url)) : geminiReply(QUALITY_OK));
    const result = await invoke("manhuaClipQualityReview", { referenceImageUrl: IMAGE_URL, videoUrl: VIDEO_URL });
    expect(result).toMatchObject({ status: 502, body: { ok: false, error: "quality_media_fetch_failed" } });
    expect(modelCalls()).toHaveLength(0);
  });
});

describe("鉴权与已删除入口", () => {
  it("三个看图入口未登录一律 401，不下载、不调模型、不落档", async () => {
    h.auth.mockResolvedValue(null);
    expect((await invoke("canvasVisionMarkdown", { prompt: "看图", images: [{ url: IMAGE_URL }] })).status).toBe(401);
    expect((await invoke("videoReversePrompt", { images: [{ url: IMAGE_URL }] })).status).toBe(401);
    expect((await invoke("manhuaClipQualityReview", { referenceImageUrl: IMAGE_URL, videoUrl: VIDEO_URL })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("gemini35FlashPing 已删除（unknown_op）；translateForVeo 仍 410；都不发任何上游请求", async () => {
    expect(await invoke("gemini35FlashPing", {})).toMatchObject({ status: 400, body: { error: "unknown_op" } });
    expect(await invoke("translateForVeo", { prompt: "雷声" })).toMatchObject({ status: 410, body: { code: "GOOGLE_VIDEO_MODEL_RETIRED" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
