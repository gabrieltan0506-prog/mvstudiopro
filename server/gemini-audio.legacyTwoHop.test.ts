import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1110 旧听音入口通道合规（离线替身，不发真实请求，参照 services/geminiMediaTwoHop.channels.test.ts）：
 * 音频实验室 / 漫剧学习听音扫描都先存 GCS，再走 Vertex gs:// → EvoLink 签名 https 两跳；
 * 不直连 Gemini API 密钥、不接第三方聚合通道、请求体不内联音频；原始与解析 JSON 分别永久落档。
 */
const h = vi.hoisted(() => ({ upload: vi.fn(), store: new Map<string, { buffer: Buffer; contentType: string }>() }));
vi.mock("./services/vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("./services/gcs", () => ({
  uploadBufferToGcsIfAbsent: h.upload,
  signGsUriV4ReadUrl: (u: string, seconds: number) => `https://signed.example/${u.slice(5)}?X-Goog-Expires=${seconds}&X-Goog-Signature=test`,
  getGcsBucketName: () => "test-bucket",
}));

import * as geminiAudio from "./gemini-audio";
import {
  DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL,
  DEFAULT_MANHUA_AUDIO_VERTEX_MODEL,
  GEMINI_AUDIO_TWO_HOP_MODEL,
  MANHUA_AUDIO_SCAN_PROMPT,
  MANHUA_AUDIO_SCAN_SCHEMA,
  analyzeAudioWithGemini,
  isGeminiAudioAvailable,
  isManhuaDramaAudioAvailable,
  listenStagedAudioJson,
  normalizeManhuaAudioScan,
  resolveManhuaAudioEvolinkModelName,
  resolveManhuaAudioVertexModelName,
} from "./gemini-audio";

const fetchMock = vi.fn();
const geminiReply = (value: unknown) => new Response(JSON.stringify({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: typeof value === "string" ? value : JSON.stringify(value) }] } }],
}), { status: 200 });
const audioDownload = (bytes: Buffer, contentType = "audio/mpeg") => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
const modelCalls = () => fetchMock.mock.calls.filter(c => /aiplatform\.googleapis\.com|direct\.evolink\.ai/.test(String(c[0])));
const allUrls = () => fetchMock.mock.calls.map(c => String(c[0]));
const allHeaders = () => fetchMock.mock.calls.map(c => JSON.stringify((c[1] as RequestInit | undefined)?.headers ?? {}));
const modelBodies = () => modelCalls().map(c => JSON.parse(String((c[1] as RequestInit).body)));
const savedJsonNames = (prefix: string) => h.upload.mock.calls.map(c => c[0].objectName as string).filter(n => n.startsWith(prefix)).map(n => n.slice(prefix.length));

/** 用户硬口径：无 Gemini 直连域名、无 GEMINI_API_KEY、无第三方聚合通道、请求体无 inlineData、EvoLink 只收 https。 */
const assertTwoHopCompliance = () => {
  const urls = allUrls().join("\n");
  expect(urls).not.toContain("generativelanguage.googleapis.com");
  expect(urls.toLowerCase()).not.toContain("openrouter");
  const wire = [urls, allHeaders().join("\n"), modelCalls().map(c => String((c[1] as RequestInit).body)).join("\n")].join("\n");
  expect(wire).not.toContain("test-direct-gemini-key");
  expect(wire).not.toContain("sk-or-test-key");
  for (const body of modelBodies()) {
    expect(JSON.stringify(body)).not.toContain("inlineData");
    expect(body.contents[0].parts[0].fileData).toBeTruthy();
  }
  for (const call of modelCalls()) {
    const url = String(call[0]);
    expect(url).toContain(GEMINI_AUDIO_TWO_HOP_MODEL);
    const fileUri = JSON.parse(String((call[1] as RequestInit).body)).contents[0].parts[0].fileData.fileUri as string;
    if (url.includes("direct.evolink.ai")) expect(fileUri).toMatch(/^https:\/\//);
    else expect(fileUri).toMatch(/^gs:\/\/test-bucket\//);
  }
  // 证据只记 gs://：签名 URL 不入档
  const evidence = Array.from(h.store.entries()).filter(([k]) => k.endsWith(".json")).map(([, v]) => v.buffer.toString("utf8")).join("\n");
  expect(evidence).not.toContain("X-Goog-Signature");
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  // 即便环境里还留着这两把旧密钥，也绝不能被用到
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
  vi.stubEnv("MANHUA_AUDIO_VERTEX_MODEL", "");
  vi.stubEnv("MANHUA_AUDIO_EVOLINK_MODEL", "");
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer, contentType }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, { buffer, contentType });
    return { created: true };
  });
});
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("通道配置", () => {
  it("听音通道默认模型名仍可显式覆盖（两跳统一用 gemini-3.8-flash 覆盖）", () => {
    expect(DEFAULT_MANHUA_AUDIO_VERTEX_MODEL).toBe("gemini-3.8-flash");
    expect(DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL).toBe("gemini-3.8-flash");
    expect(resolveManhuaAudioVertexModelName()).toBe(DEFAULT_MANHUA_AUDIO_VERTEX_MODEL);
    expect(resolveManhuaAudioEvolinkModelName()).toBe(DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL);
    vi.stubEnv("MANHUA_AUDIO_VERTEX_MODEL", "gemini-3.6-flash-custom");
    expect(resolveManhuaAudioVertexModelName()).toBe("gemini-3.6-flash-custom");
    expect(GEMINI_AUDIO_TWO_HOP_MODEL).toBe("gemini-3.8-flash");
  });

  it("可用性只看 Vertex / EvoLink；只剩 GEMINI_API_KEY / OPENROUTER_API_KEY 时判不可用", () => {
    expect(isGeminiAudioAvailable()).toBe(true);
    vi.stubEnv("VERTEX_PROJECT_ID", "");
    expect(isManhuaDramaAudioAvailable()).toBe(true);
    vi.stubEnv("EVOLINK_API_KEY", "");
    expect(isManhuaDramaAudioAvailable()).toBe(false);
    expect(isGeminiAudioAvailable()).toBe(false);
  });

  it("旧四路听音函数（第三方聚合 / Gemini API 直连 / 单通道 / 旧 fallback）已删除，生产只剩两跳", () => {
    for (const removed of [
      "analyzeManhuaDramaAudioFromUrl", "analyzeManhuaDramaAudioWithFallback", "analyzeManhuaDramaAudioWithGemini",
      "analyzeManhuaDramaAudioWithVertex", "analyzeManhuaDramaAudioWithEvolink", "analyzeManhuaDramaAudioWithOpenRouter",
      "analyzeManhuaDramaAudioWithGeminiApi", "resolveManhuaAudioOpenRouterModelName", "resolveManhuaAudioGeminiApiModelName",
      "isManhuaDramaGeminiApiAudioAvailable", "mapManhuaAudioProviderFailure", "isManhuaAudioFailureRetryable",
    ]) {
      expect(removed in geminiAudio).toBe(false);
    }
  });

  it("源码不再引用直连密钥、直连域名、聚合通道与内联音频", () => {
    for (const file of ["./gemini-audio.ts", "./_core/voiceTranscription.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src).not.toMatch(/GEMINI_API_KEY|generativelanguage\.googleapis|openrouter\.ai|OPENROUTER_|openrouterAuth|@google\/genai|api\.openai\.com|inlineData/);
    }
  });
});

describe("漫剧学习听音扫描：提示词 / schema / 整形一处真源 + 存 GCS 两跳", () => {
  const scan = { language: "zh", transcriptSummary: "主角受辱后反击。", sections: [{ name: "开场钩子", timeRange: "0:00-0:12", mood: "压迫", energy: "高", lyrics: "你不能进去。" }] };

  it("api/google.ts 改为 import 本模块导出，不再抄写提示词 / schema / 整形", () => {
    const api = readFileSync(new URL("../api/google.ts", import.meta.url), "utf8");
    expect(api).not.toMatch(/const MANHUA_AUDIO_SCAN_PROMPT|const MANHUA_AUDIO_SCAN_SCHEMA|function normalizeManhuaAudioScan/);
    expect(api).toMatch(/MANHUA_AUDIO_SCAN_PROMPT, MANHUA_AUDIO_SCAN_SCHEMA, normalizeManhuaAudioScan } = await import\("\.\.\/server\/gemini-audio"\)/);
    expect(MANHUA_AUDIO_SCAN_PROMPT).toContain("energy 用：低 / 中 / 高 / 极高");
    expect(MANHUA_AUDIO_SCAN_SCHEMA.required).toEqual(["language", "transcriptSummary", "sections"]);
  });

  it("整形：字段规整、空唱词置 undefined；非对象或缺 sections 判写坏", () => {
    expect(normalizeManhuaAudioScan({ ...scan, language: " zh ", sections: [{ ...scan.sections[0], lyrics: "" }] })).toEqual({
      language: "zh", transcriptSummary: "主角受辱后反击。", sections: [{ name: "开场钩子", timeRange: "0:00-0:12", mood: "压迫", energy: "高", lyrics: undefined }],
    });
    expect(() => normalizeManhuaAudioScan({ language: "zh", transcriptSummary: "x" })).toThrow("缺少 sections");
    expect(() => normalizeManhuaAudioScan([scan])).toThrow("不是 JSON 对象");
  });

  it("listenStagedAudioJson：音频按 SHA 存 GCS；Vertex 503 → EvoLink 签名 https（3600 秒）；raw/decoded/parsed 分别落档", async () => {
    const bytes = Buffer.from("manhua-audio-bytes");
    const sha = createHash("sha256").update(bytes).digest("hex");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(geminiReply(scan));
    const out = await listenStagedAudioJson({ area: "test-area/scan", audio: bytes, mimeType: "audio/mpeg; charset=binary", prompt: MANHUA_AUDIO_SCAN_PROMPT, nativeSchema: MANHUA_AUDIO_SCAN_SCHEMA, schemaName: "manhua_drama_audio_scan", validate: normalizeManhuaAudioScan });
    expect([out.channel, out.model, out.value.sections[0]!.lyrics]).toEqual(["EvoLink", "gemini-3.8-flash", "你不能进去。"]);
    const audioObject = `test-area/scan/${sha}/audio.mp3`;
    expect(out.audioGsUri).toBe(`gs://test-bucket/${audioObject}`);
    expect(h.store.get(audioObject)).toEqual({ buffer: bytes, contentType: "audio/mpeg" });
    expect(modelBodies()[0].contents[0].parts[0].fileData).toEqual({ mimeType: "audio/mpeg", fileUri: `gs://test-bucket/${audioObject}` });
    expect(modelBodies()[1].contents[0].parts[0].fileData.fileUri).toBe(`https://signed.example/test-bucket/${audioObject}?X-Goog-Expires=3600&X-Goog-Signature=test`);
    expect(modelBodies()[0].generationConfig).toMatchObject({ audioTimestamp: true, responseMimeType: "application/json", responseSchema: { type: "OBJECT" } });
    expect(String(modelCalls()[0]![0])).toBe("https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent");
    expect(String(modelCalls()[1]![0])).toBe("https://direct.evolink.ai/v1beta/models/gemini-3.8-flash:generateContent");
    assertTwoHopCompliance();
    const prefix = out.evidencePrefix.replace("gs://test-bucket/", "") + "/";
    expect(prefix.startsWith(`test-area/scan/${sha}/attempts/`)).toBe(true);
    expect(savedJsonNames(prefix)).toEqual([
      "request.json", "hop-1-vertex-request.json", "hop-1-vertex-raw.json",
      "hop-2-evolink-request.json", "hop-2-evolink-raw.json", "hop-2-evolink-decoded.json", "hop-2-evolink-parsed.json", "hop-used.json",
    ]);
    expect(JSON.parse(h.store.get(`${prefix}request.json`)!.buffer.toString())).toMatchObject({ audioGsUri: `gs://test-bucket/${audioObject}`, model: "gemini-3.8-flash" });
  });

  it("写坏（缺 sections）也换下一跳；两跳都坏则失败", async () => {
    fetchMock.mockResolvedValue(geminiReply({ language: "zh", transcriptSummary: "x" }));
    await expect(listenStagedAudioJson({ area: "test-area/scan", audio: Buffer.from("a"), mimeType: "audio/mpeg", prompt: MANHUA_AUDIO_SCAN_PROMPT, nativeSchema: MANHUA_AUDIO_SCAN_SCHEMA, schemaName: "s", validate: normalizeManhuaAudioScan })).rejects.toThrow("全部通道失败");
    expect(modelCalls()).toHaveLength(2);
    assertTwoHopCompliance();
  });

  it("两跳都未配置时不上传、不发请求（即使还有旧直连密钥）", async () => {
    vi.stubEnv("VERTEX_PROJECT_ID", "");
    vi.stubEnv("EVOLINK_API_KEY", "");
    await expect(listenStagedAudioJson({ area: "test-area/scan", audio: Buffer.from("a"), mimeType: "audio/mpeg", prompt: "听", schemaName: "s", validate: v => v })).rejects.toThrow("未配置");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
});

describe("音频实验室 analyzeAudioWithGemini（routers audioLab.analyze）", () => {
  const analysis = {
    bpm: 120, bpmRange: "115-125", overallMood: "欢快", language: "中文", lyrics: "歌词",
    sections: [{ name: "前奏", timeRange: "0:00-0:15", mood: "期待", energy: "中", instruments: "钢琴", rhythmPattern: "4/4" }],
    instrumentation: "钢琴", suggestedColorPalette: "暖色", suggestedVisualStyle: "街景", genre: "流行", musicalKey: "C大调", dynamicRange: "中等",
  };

  it("下载 → 存 GCS → Vertex 写坏（BPM 无效）→ EvoLink 签名 https；返回结构不变", async () => {
    const bytes = Buffer.from("song-bytes");
    fetchMock
      .mockResolvedValueOnce(audioDownload(bytes, "application/octet-stream"))
      .mockResolvedValueOnce(geminiReply({ ...analysis, bpm: "快" }))
      .mockResolvedValueOnce(geminiReply(analysis));
    const result = await analyzeAudioWithGemini("https://cdn.example/song.mp3");
    expect(result).toEqual(analysis);
    expect(modelCalls()).toHaveLength(2);
    expect(modelBodies()[0].contents[0].parts[0].fileData).toEqual({ mimeType: "audio/mpeg", fileUri: expect.stringMatching(/^gs:\/\/test-bucket\/audio-lab\/analysis\/[0-9a-f]{64}\/audio\.mp3$/) });
    expect(modelBodies()[1].contents[0].parts[0].fileData.fileUri).toMatch(/^https:\/\/signed\.example\/test-bucket\/audio-lab\/analysis\//);
    expect(modelBodies()[0].contents[0].parts[1].text).toContain("BPM");
    assertTwoHopCompliance();
    expect(Array.from(h.store.keys()).some(k => /\/hop-1-vertex-rejected\.json$/.test(k))).toBe(true);
    expect(Array.from(h.store.keys()).some(k => /\/hop-2-evolink-parsed\.json$/.test(k))).toBe(true);
  });

  it("下载失败照旧抛错，不发模型请求", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(analyzeAudioWithGemini("https://cdn.example/missing.mp3")).rejects.toThrow("Failed to download audio: 404");
    expect(modelCalls()).toHaveLength(0);
  });
});
