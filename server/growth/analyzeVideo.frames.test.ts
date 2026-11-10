import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1110 用户规矩「不传 base64 图片，用签名 URL」（离线替身，不发任何真实 / 付费请求）：
 * 成长营视频分析的帧图先存 GCS（growth-camp/frames/<runId>/），
 * 关键帧视觉初判（Gemini）走 Vertex gs:// → EvoLink 签名 https 两跳，GPT 跳收签名 https；
 * 证据（growth-camp/evidence/<runId>/）只记 gs://，不落签名链接。
 */
const h = vi.hoisted(() => ({
  framesUploaded: [] as Array<{ objectName: string; contentType: string; bytes: number }>,
  evidence: new Map<string, string>(),
  deleted: [] as string[],
  signCalls: [] as Array<{ gsUri: string; ttl: number }>,
  llmCalls: [] as any[],
  fetchCalls: [] as Array<{ url: string; body: string }>,
}));

vi.mock("../services/gcs", () => ({
  isGsUri: (value: string) => /^gs:\/\//i.test(String(value || "").trim()),
  getGcsBucketName: () => "test-bucket",
  uploadBufferToGcs: async ({ objectName, buffer, contentType }: { objectName: string; buffer: Buffer; contentType: string }) => {
    h.framesUploaded.push({ objectName, contentType, bytes: buffer.byteLength });
    return { bucket: "test-bucket", objectName, gcsUri: `gs://test-bucket/${objectName}` };
  },
  uploadBufferToGcsIfAbsent: async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    if (h.evidence.has(objectName)) return { created: false };
    h.evidence.set(objectName, buffer.toString("utf8"));
    return { created: true };
  },
  signGsUriV4ReadUrl: (gsUri: string, ttl: number) => {
    h.signCalls.push({ gsUri, ttl });
    return `https://signed.example/${gsUri.slice(5)}?X-Goog-Expires=${ttl}&X-Goog-Signature=test-sig`;
  },
  deleteGcsObject: async ({ objectName }: { objectName: string }) => { h.deleted.push(objectName); },
  downloadGcsObject: async () => { throw new Error("not used"); },
}));
vi.mock("../services/vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("../_core/voiceTranscription", () => ({
  transcribeAudio: async () => ({ text: "大家好，今天演示如何三步拆解一条爆款短视频，先看开头钩子，再看中段案例，最后看结尾转化。" }),
}));
vi.mock("../storage", () => ({ storageRead: async () => null }));
vi.mock("../_core/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/llm")>();
  return { ...actual, invokeLLM: async (params: any) => { h.llmCalls.push(params); return fakeLlmReply(params); } };
});

import { analyzeVideo } from "./analyzeVideo";
import { resolveGrowthCampExtractorModel } from "./extractorPipeline";

const reply = (value: unknown) => ({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });

const EXTRACT_MARKDOWN = [
  "## 视频基本信息", "- 文件名：demo.mp4", "- 时长：6 秒", "",
  "## 口播/字幕整理", "### 00:00–00:04", `${"主讲人逐步讲解爆款短视频的开头钩子、中段案例与结尾转化，语速平稳、重点句清晰。".repeat(14)}`, "",
  "## 内容大纲", "- 主题：三步拆解爆款短视频", "",
  "## 画面描述", `${"画面为彩色测试卡与移动方块，构图稳定，00:01 与 00:03 处色块位置变化明显。".repeat(14)}`, "",
  "## 关键时刻", "- 00:02｜讲解钩子｜色块切换",
].join("\n");

function fakeLlmReply(params: any) {
  const name = params?.response_format?.json_schema?.name;
  const system = String(params?.messages?.[0]?.content || "");
  if (params.provider === "vertex" && name === "growth_camp_strategist_output") {
    // 音频粗筛（Vertex gs:// 音轨；不在本次改动范围）
    return reply({ valueTier: "high", contentSummary: "口播拆解", hookSummary: "开头抛问题", audiencePromise: "三步学会", commercialPotential: 7, creatorSignals: [], priorityMoments: [{ timestamp: "00:02", reason: "钩子", action: "加字幕" }], riskMoments: [], deepDiveBrief: "看中段", transcriptSummary: "讲解", bgmAnalysis: { detected: false } });
  }
  if (params.provider === "vertex") {
    // 提取模式语音 scan（Flash 文本，不带图）
    return reply({ priorityMoments: [{ timestamp: "00:02", label: "钩子" }], topicHint: "爆款拆解" });
  }
  if (name === "growth_camp_strategist_output") {
    return reply({
      explosiveIndex: 7, composition: 70, color: 66, lighting: 62, impact: 74, viralPotential: 71,
      platformScores: { xiaohongshu: 7, douyin: 8, bilibili: 6, kuaishou: 7 },
      realityCheck: "开头钩子有效", reverseEngineering: { hookStrategy: "问题钩子", emotionalArc: "平稳上扬", commercialLogic: "课程转化" },
      summary: "可复用的拆解型口播",
    });
  }
  if (name === "growth_camp_premium_growth" || name === "growth_camp_premium_remix") return reply({});
  if (/视频画面记录员/.test(system)) {
    return reply({ visualSummary: "测试卡画面", openingFrameAssessment: "开场色块", sceneConsistency: "一致", trustSignals: [], visualRisks: [], keyFrames: [{ timestamp: "00:02", whatShows: "彩色测试卡与移动方块，画面稳定。", commercialUse: "", issue: "", fix: "" }] });
  }
  if (/视频内容整理助手/.test(system)) return reply({ extractedContent: EXTRACT_MARKDOWN, summary: "三步拆解爆款短视频" });
  throw new Error(`unexpected invokeLLM call: ${name || system.slice(0, 40)}`);
}

const VISUAL_REPLY = {
  visualSummary: "画面整体情绪基调：明快、节奏均匀。",
  openingFrameAssessment: "开场色块醒目",
  sceneConsistency: "风格统一",
  trustSignals: ["演示稳定"],
  visualRisks: ["缺少人物"],
  keyFrames: [{ timestamp: "00:01", whatShows: "EvoLink 两跳看到的测试卡", commercialUse: "做封面", issue: "无人物", fix: "加入主讲人", emotionalTension: "平稳" }],
};
const geminiOk = (value: unknown) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const geminiHttpError = (status: number) => ({ ok: false, status, json: async () => ({ error: { code: status } }) });

const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
  h.fetchCalls.push({ url: String(url), body: String(init?.body || "") });
  return fetchPlan.shift()!();
});
let fetchPlan: Array<() => unknown> = [];

let dir = "";
let videoBase64 = "";
let mediaToolsAvailable = false;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  mediaToolsAvailable = true;
} catch { /* 不具备媒体工具的测试机显式跳过，生产镜像已安装。 */ }

beforeAll(async () => {
  if (!mediaToolsAvailable) return;
  dir = await mkdtemp(path.join(tmpdir(), "growth-frames-test-"));
  const videoPath = path.join(dir, "demo.mp4");
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-shortest", "-c:v", "mpeg4", "-c:a", "aac", videoPath,
  ], { stdio: "ignore" });
  videoBase64 = (await readFile(videoPath)).toString("base64");
});
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
  vi.stubEnv("GROWTH_CAMP_EXTRACTOR_MODEL", "");
  h.framesUploaded.length = 0;
  h.evidence.clear();
  h.deleted.length = 0;
  h.signCalls.length = 0;
  h.llmCalls.length = 0;
  h.fetchCalls.length = 0;
  fetchPlan = [];
  fetchMock.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const frameObjects = () => h.framesUploaded.filter(item => item.objectName.startsWith("growth-camp/frames/"));
const runIdOf = () => /^growth-camp\/frames\/([^/]+)\//.exec(frameObjects()[0]!.objectName)![1]!;
const allEvidenceText = () => Array.from(h.evidence.values()).join("\n");
const imageUrlsSentToGpt = () => h.llmCalls
  .filter(call => call.provider === "openai")
  .flatMap(call => call.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])))
  .filter((part: any) => part?.type === "image_url")
  .map((part: any) => String(part.image_url.url));
const assertNoInlineImage = () => {
  const everythingSent = [...h.fetchCalls.map(c => c.body), JSON.stringify(h.llmCalls)].join("\n");
  expect(everythingSent).not.toContain("inlineData");
  expect(everythingSent).not.toMatch(/data:image|;base64,/);
};

describe.skipIf(!mediaToolsAvailable)("成长营视频分析：帧图存 GCS，不内联 base64", () => {
  it("完整分析：Vertex 失败 → EvoLink；Vertex 收 gs://、EvoLink 与 GPT 收签名 https；证据只记 gs://；结果结构不变", async () => {
    fetchPlan = [() => geminiHttpError(503), () => geminiOk(VISUAL_REPLY)];
    const result = await analyzeVideo({ fileBase64: videoBase64, mimeType: "video/mp4", fileName: "demo.mp4", context: "知识博主", mode: "GROWTH" });

    // 帧图：jpg 存 growth-camp/frames/<runId>/，与视频副本同一任务编号
    const frames = frameObjects();
    expect(frames.length).toBe(10);
    const runId = runIdOf();
    expect(frames.every(f => f.contentType === "image/jpeg" && f.bytes > 0 && /^growth-camp\/frames\/[^/]+\/\d{3}-\d+ms\.jpg$/.test(f.objectName))).toBe(true);
    expect(h.framesUploaded.some(f => f.objectName === `growth-camp/videos/${runId}-demo.mp4`)).toBe(true);
    const frameGsUris = frames.map(f => `gs://test-bucket/${f.objectName}`);

    // 关键帧视觉初判：两跳，模型取领域 growthCampExtractor 缺省（与改动前一致）
    expect(h.fetchCalls).toHaveLength(2);
    const [vertex, evolink] = h.fetchCalls;
    expect(vertex!.url).toBe("https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.5-flash:generateContent");
    expect(evolink!.url).toBe("https://direct.evolink.ai/v1beta/models/gemini-3.5-flash:generateContent");
    const vertexParts = JSON.parse(vertex!.body).contents[0].parts;
    const evolinkParts = JSON.parse(evolink!.body).contents[0].parts;
    expect(vertexParts.slice(0, -1).map((p: any) => p.fileData)).toEqual(frameGsUris.map(fileUri => ({ mimeType: "image/jpeg", fileUri })));
    expect(evolinkParts.slice(0, -1).map((p: any) => p.fileData.fileUri)).toEqual(frameGsUris.map(u => expect.stringMatching(new RegExp(`^https://signed\\.example/${u.slice(5).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`))));
    expect(vertexParts.at(-1).text).toContain("关键帧时间点");
    expect(JSON.parse(vertex!.body).systemInstruction.parts[0].text).toContain("关键帧视觉初判");

    // GPT 跳（Strategist）同样只收签名 https，签名约 2 小时
    const gptUrls = imageUrlsSentToGpt();
    expect(gptUrls.length).toBeGreaterThan(0);
    expect(gptUrls.every(u => /^https:\/\/signed\.example\/test-bucket\/growth-camp\/frames\//.test(u))).toBe(true);
    expect(h.signCalls.length).toBeGreaterThan(0);
    expect(h.signCalls.every(c => c.ttl === 2 * 3600 && frameGsUris.includes(c.gsUri))).toBe(true);
    assertNoInlineImage();

    // 证据：永久目录、原始与解析分别落档、只记 gs://、无签名链接
    const prefix = `growth-camp/evidence/${runId}/visual-first-pass-1/`;
    expect(Array.from(h.evidence.keys())).toEqual([
      "request", "hop-1-vertex-request", "hop-1-vertex-raw", "hop-2-evolink-request", "hop-2-evolink-raw",
      "hop-2-evolink-decoded", "hop-2-evolink-parsed", "hop-used",
    ].map(name => `${prefix}${name}.json`));
    const hopRequest = JSON.parse(h.evidence.get(`${prefix}hop-2-evolink-request.json`)!);
    expect([hopRequest.mediaGsUri, ...hopRequest.extraMedia.map((m: any) => m.gsUri)]).toEqual(frameGsUris);
    expect(JSON.parse(h.evidence.get(`${prefix}request.json`)!).frames.map((f: any) => f.gcsUri)).toEqual(frameGsUris);
    expect(allEvidenceText()).not.toMatch(/https?:\/\/signed\.example|X-Goog-Signature|test-sig/);

    // 清理口径：帧图随视频 / 音轨临时副本清理；证据从不删除
    expect(h.deleted).toEqual(expect.arrayContaining(frames.map(f => f.objectName)));
    expect(h.deleted.some(name => name.startsWith("growth-camp/evidence/"))).toBe(false);

    // 结果结构不变：视觉初判仍并入 keyFrames
    expect(Object.keys(result.videoMeta).sort()).toEqual([
      "audioUrl", "estimatedCostProfile", "failureReason", "failureStage", "fallback", "model", "pipeline", "provider",
      "sparseFrameCount", "stageOneModel", "stageTwoModel", "transcript", "videoDuration", "videoUrl",
    ]);
    expect(result.videoMeta.sparseFrameCount).toBe(10);
    expect(result.analysis.keyFrames?.[0]?.whatShows).toBe("EvoLink 两跳看到的测试卡");
  });

  it("模型不写死：GROWTH_CAMP_EXTRACTOR_MODEL 生效；Vertex 成功即不再调用 EvoLink", async () => {
    vi.stubEnv("GROWTH_CAMP_EXTRACTOR_MODEL", "gemini-3.9-flash");
    expect(resolveGrowthCampExtractorModel()).toBe("gemini-3.9-flash");
    fetchPlan = [() => geminiOk(VISUAL_REPLY)];
    await analyzeVideo({ fileBase64: videoBase64, mimeType: "video/mp4", fileName: "demo.mp4", mode: "REMIX" });
    expect(h.fetchCalls.map(c => c.url)).toEqual([
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.9-flash:generateContent",
    ]);
    const used = Array.from(h.evidence.entries()).find(([name]) => name.endsWith("/hop-used.json"))!;
    expect(JSON.parse(used[1])).toMatchObject({ channel: "Vertex", model: "gemini-3.9-flash", hop: 1 });
    assertNoInlineImage();
  });

  it("提取模式：GPT 视觉描述与 Markdown 整理两跳都只收签名 https", async () => {
    const result = await analyzeVideo({ fileBase64: videoBase64, mimeType: "video/mp4", fileName: "demo.mp4", analysisProfile: "extract_only" });
    expect(result.analysis.extractedContent).toContain("## 画面描述");
    const frames = frameObjects();
    expect(frames.length).toBeGreaterThan(0);
    const gptUrls = imageUrlsSentToGpt();
    // 视觉描述 + 内容整理各带一遍全部帧图
    expect(gptUrls).toHaveLength(frames.length * 2);
    expect(gptUrls.every(u => /^https:\/\/signed\.example\/test-bucket\/growth-camp\/frames\/.+\?X-Goog-Expires=7200&/.test(u))).toBe(true);
    expect(h.fetchCalls).toHaveLength(0);
    assertNoInlineImage();
  });

  it("平台参考素材（lite）：Strategist 只收签名 https", async () => {
    await analyzeVideo({ fileBase64: videoBase64, mimeType: "video/mp4", fileName: "demo.mp4", platformAssetLite: true });
    const gptUrls = imageUrlsSentToGpt();
    expect(gptUrls.length).toBeGreaterThan(0);
    expect(gptUrls.every(u => /^https:\/\/signed\.example\/test-bucket\/growth-camp\/frames\//.test(u))).toBe(true);
    assertNoInlineImage();
  });
});
