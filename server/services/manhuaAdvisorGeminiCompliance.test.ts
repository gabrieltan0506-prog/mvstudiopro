import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1110 漫剧创作顾问 Gemini 合规（离线替身，不发真实请求）：看片 / 配乐 / 字幕
 * 模型经 resolveGeminiModel 解析（缺省 3.8 Flash、env 覆盖生效）；只走 Vertex gs:// → EvoLink 签名 https；请求体无 inlineData。
 */
const h = vi.hoisted(() => ({ upload: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("./vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("./gcs", async (importOriginal) => ({
  ...await importOriginal<typeof import("./gcs")>(),
  inspectGcsObjectBounded: async ({ gcsUri }: { gcsUri: string }) => ({ header: Buffer.from(gcsUri.endsWith(".wav") ? "RIFF0000WAVE0000" : "0000ftypisom0000"), sha256: "a".repeat(64), byteLength: 16 }),
  uploadBufferToGcsIfAbsent: h.upload,
  signGsUriV4ReadUrl: (u: string) => `https://signed.example/${u.slice(5)}?X-Goog-Signature=test`,
  getGcsBucketName: () => "test-bucket",
}));
vi.mock("./postProdMediaSource", () => ({ resolvePostProdInputSources: async ({ input }: any) => input }));
vi.mock("./manhuaNativeDeepReadRunner", async (importOriginal) => ({
  ...await importOriginal<typeof import("./manhuaNativeDeepReadRunner")>(),
  assertNativeDeepReadRequiredSegmentEvidence: vi.fn(),
  evaluateNativeDeepReadSegmentAcceptance: vi.fn(() => ({ retry: false, advisories: [] })),
}));

import { askManhuaBgmMix, resolveManhuaAdvisorBgmModel } from "./manhuaAdvisorBgmMix";
import { askManhuaSubtitleReview, resolveManhuaAdvisorSubtitleModel } from "./manhuaAdvisorSubtitle";
import { askManhuaFilmReview, resolveManhuaAdvisorWatchModel } from "./manhuaAdvisorFilmReview";
import { resolveGeminiModel } from "../../shared/geminiModelConfig";

const fetchMock = vi.fn();
const reply = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }) });
const fail503 = () => ({ ok: false, status: 503, json: async () => ({}) });
const sentBodies = () => fetchMock.mock.calls.map(c => String((c[1] as RequestInit).body));
const sentUrls = () => fetchMock.mock.calls.map(c => String(c[0]));
const fileUris = (body: string) => (JSON.parse(body).contents[0].parts as Array<{ fileData?: { fileUri: string } }>).filter(p => p.fileData).map(p => p.fileData!.fileUri);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  for (const name of ["GEMINI_DEFAULT_MODEL", "GEMINI_AUDIO_TWO_HOP_MODEL", "MANHUA_ADVISOR_WATCH_MODEL", "MANHUA_ADVISOR_BGM_MODEL", "MANHUA_ADVISOR_SUBTITLE_MODEL"]) vi.stubEnv(name, "");
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, JSON.parse(buffer.toString()));
    return { created: true };
  });
});
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("模型解析（不写死）", () => {
  it("缺省一律 gemini-3.8-flash；领域 env 覆盖各自生效；GEMINI_DEFAULT_MODEL 改全局", () => {
    expect([resolveManhuaAdvisorWatchModel(), resolveManhuaAdvisorBgmModel(), resolveManhuaAdvisorSubtitleModel()]).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash"]);
    const env = { GEMINI_DEFAULT_MODEL: "gemini-3.9-flash", MANHUA_ADVISOR_WATCH_MODEL: "gemini-4.0-flash", MANHUA_ADVISOR_BGM_MODEL: " gemini-4.1-flash ", MANHUA_ADVISOR_SUBTITLE_MODEL: "  " };
    expect(resolveGeminiModel("manhuaAdvisorWatch", env)).toBe("gemini-4.0-flash");
    expect(resolveGeminiModel("manhuaAdvisorBgm", env)).toBe("gemini-4.1-flash");
    expect(resolveGeminiModel("manhuaAdvisorSubtitle", env)).toBe("gemini-3.9-flash");
  });
});

describe("配乐顾问：成片 + BGM 两跳", () => {
  const target = { sourceKey: "v1", videoUri: "gs://test-bucket/post-prod/7/video.mp4", bgmUri: "gs://test-bucket/post-prod/7/music.wav", entrySec: 0, durationSec: 29, volume: 0.5, fadeInSec: 0, fadeOutSec: 0 };
  const shell = { answer: { kind: "bgm_mix_v1", sourceKey: "v1", summaryZh: "原曲配合表演", narrativeMix: [], duckUnderDialogue: false, uncertaintiesZh: [] }, imageIntent: false, creationRelated: false, suggestedImagePrompt: "", guideMessage: "" };
  it("缺省 3.8 Flash：Vertex 503 → EvoLink；Vertex 收 gs://、EvoLink 收签名 https；无 inlineData、无直连密钥；签名不入档", async () => {
    fetchMock.mockResolvedValueOnce(fail503()).mockResolvedValueOnce(reply(JSON.stringify(shell)));
    const out = JSON.parse(await askManhuaBgmMix(7, target, [{ role: "user", content: "配乐" }]));
    expect(out.answer.kind).toBe("bgm_mix_v1");
    expect(sentUrls()[0]).toContain("aiplatform.googleapis.com");
    expect(sentUrls()[1]).toContain("evolink.ai");
    expect(sentUrls().every(u => u.includes("/models/gemini-3.8-flash:generateContent"))).toBe(true);
    expect(fileUris(sentBodies()[0]!)).toEqual([target.videoUri, target.bgmUri]);
    const evo = fileUris(sentBodies()[1]!);
    expect(evo).toHaveLength(2);
    expect(evo.every(u => /^https:\/\//.test(u))).toBe(true);
    expect(sentBodies().join("\n")).not.toContain("inlineData");
    // 提示词里的 target 原样含 gs:// 字段（沿用原合同）；媒体 fileData 只有 https（上方已断言）
    expect(JSON.stringify(fetchMock.mock.calls.map(c => (c[1] as RequestInit).headers))).not.toContain("test-direct-gemini-key");
    expect(JSON.stringify(Array.from(h.store.values()))).not.toContain("X-Goog-Signature");
    const names = Array.from(h.store.keys()).map(n => n.split("/").at(-1));
    expect(names).toEqual(expect.arrayContaining(["request.json", "hop-1-vertex-raw.json", "hop-2-evolink-raw.json", "hop-2-evolink-decoded.json", "hop-2-evolink-parsed.json", "bgm-mix-parsed.json"]));
  });
  it("env 覆盖生效：MANHUA_ADVISOR_BGM_MODEL 决定两跳模型", async () => {
    vi.stubEnv("MANHUA_ADVISOR_BGM_MODEL", "gemini-3.9-flash");
    fetchMock.mockResolvedValueOnce(reply(JSON.stringify(shell)));
    await askManhuaBgmMix(7, target, []);
    expect(sentUrls()[0]).toContain("/models/gemini-3.9-flash:generateContent");
  });
});

describe("字幕顾问两跳", () => {
  it("env 覆盖生效；EvoLink fileUri 为签名 https；无 inlineData", async () => {
    vi.stubEnv("MANHUA_ADVISOR_SUBTITLE_MODEL", "gemini-3.9-flash");
    fetchMock.mockResolvedValueOnce(fail503()).mockResolvedValueOnce(reply(JSON.stringify({ answer: "字幕报告" })));
    expect(JSON.parse(await askManhuaSubtitleReview(7, { videoUri: "gs://test-bucket/clip.mp4", dialogue: "已确认" })).answer).toBe("字幕报告");
    expect(sentUrls().every(u => u.includes("/models/gemini-3.9-flash:generateContent"))).toBe(true);
    expect(fileUris(sentBodies()[0]!)).toEqual(["gs://test-bucket/clip.mp4"]);
    expect(fileUris(sentBodies()[1]!)[0]).toMatch(/^https:\/\/signed\.example\//);
    expect(sentBodies().join("\n")).not.toContain("inlineData");
  });
});

describe("看片（影片审阅）两跳", () => {
  const target = { videoUri: "gs://test-bucket/film.mp4", blockId: "clip-1", revision: "v1", label: "第1段" };
  const analysis = { filmReview: { summary: "构图有层次", findings: [{ kind: "亮点", atSec: 1, endSec: 2, category: "构图", observation: "前景遮挡", suggestion: "保留层次", confidence: "明确" }], limitations: "声音仍需核对" } };
  const ok = (model: string) => ({ status: 200, text: JSON.stringify({ modelVersion: model, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(analysis) }] } }] }) });
  const deps = () => ({
    resolve: vi.fn().mockResolvedValue("gs://test-bucket/film.mp4"),
    inspect: vi.fn().mockResolvedValue({ generation: "1" }),
    probe: vi.fn().mockResolvedValue({ durationSec: 5, audioStreams: [{}] }),
    count: vi.fn().mockResolvedValue({ totalTokens: 100 }),
    post: vi.fn().mockResolvedValue({ status: 503, text: "{}" }),
    postEvolink: vi.fn(async (_body: unknown, model: string) => ok(model)),
    sign: (u: string) => `https://signed.example/${u.slice(5)}?X-Goog-Signature=test`,
    save: vi.fn().mockResolvedValue("saved"),
  });
  it("缺省 3.8 Flash：Vertex 收 gs://，失败后 EvoLink 收签名 https；无 inlineData；签名不入档", async () => {
    const d = deps();
    const result = JSON.parse(JSON.parse(await askManhuaFilmReview(7, target, "灯光", d as any)).answer);
    expect(result.findings).toHaveLength(1);
    expect(d.post.mock.calls[0]![1]).toBe("gemini-3.8-flash");
    expect(d.count.mock.calls[0]![1]).toBe("gemini-3.8-flash");
    expect(d.postEvolink.mock.calls[0]![1]).toBe("gemini-3.8-flash");
    expect(fileUris(JSON.stringify(d.post.mock.calls[0]![0]))).toEqual(["gs://test-bucket/film.mp4"]);
    const evoBody = JSON.stringify(d.postEvolink.mock.calls[0]![0]);
    expect(fileUris(evoBody)[0]).toMatch(/^https:\/\/signed\.example\//);
    expect(evoBody).not.toContain("gs://");
    expect(evoBody + JSON.stringify(d.post.mock.calls[0]![0])).not.toContain("inlineData");
    const saved = d.save.mock.calls.map(c => c[0]);
    expect(saved.map(s => s.buffer.toString()).join("\n")).not.toContain("X-Goog-Signature");
    expect(saved.map(s => s.objectName.split("/").at(-1))).toEqual(expect.arrayContaining(["request.json", "hop-1-vertex-raw.json", "hop-1-vertex-rejected.json", "hop-2-evolink-raw.json", "hop-2-evolink-analysis.json", "report.json"]));
  });
  it("env 覆盖生效：MANHUA_ADVISOR_WATCH_MODEL 决定预检与两跳模型", async () => {
    vi.stubEnv("MANHUA_ADVISOR_WATCH_MODEL", "gemini-3.9-flash");
    const d = deps();
    d.post.mockResolvedValue(ok("gemini-3.9-flash"));
    await askManhuaFilmReview(7, target, "灯光", d as any);
    expect([d.count.mock.calls[0]![1], d.post.mock.calls[0]![1]]).toEqual(["gemini-3.9-flash", "gemini-3.9-flash"]);
    expect(d.postEvolink).not.toHaveBeenCalled();
  });
});
