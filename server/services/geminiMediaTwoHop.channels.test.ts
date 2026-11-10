import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 1109 通道合规（离线替身，不发真实请求）：MV 听歌与剪辑方案分析都走 Vertex gs:// → EvoLink 签名 URL 两跳。 */
const h = vi.hoisted(() => ({ upload: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("./vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));
vi.mock("./gcs", () => ({
  inspectGcsObjectBounded: async () => ({ header: Buffer.from("0000ftyp0000test"), sha256: "a".repeat(64), byteLength: 16 }),
  uploadBufferToGcsIfAbsent: h.upload,
  signGsUriV4ReadUrl: (u: string) => `https://signed.example/${u.slice(5)}?X-Goog-Signature=test`,
  downloadGcsObject: async () => { throw new Error("404 not found"); },
  getGcsBucketName: () => "test-bucket",
}));
vi.mock("./postProdMediaSource", () => ({ resolvePostProdInputSources: async ({ input }: any) => input }));

import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { askManhuaSubtitleReview } from "./manhuaAdvisorSubtitle";
import { hearSongIndependently, SONG_HEARING_MODEL } from "./musicMvSongHearing";
import { isPerformerTheUser, performerLabelZh } from "../../shared/canvasMusicMvReferences";

const fetchMock = vi.fn();
const geminiReply = (text: string, audioTokens = 40) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: audioTokens }] } }),
});
const sentBodies = () => fetchMock.mock.calls.map(c => String((c[1] as RequestInit).body));
const sentUrls = () => fetchMock.mock.calls.map(c => String(c[0]));
const sentHeaders = () => fetchMock.mock.calls.map(c => JSON.stringify((c[1] as RequestInit).headers));
const savedNames = (prefix: string) => h.upload.mock.calls.map(c => c[0].objectName as string).filter(n => n.startsWith(prefix)).map(n => n.slice(prefix.length));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  h.store.clear();
  h.upload.mockReset().mockImplementation(async ({ objectName, buffer }: any) => {
    if (h.store.has(objectName)) return { created: false };
    h.store.set(objectName, JSON.parse(buffer.toString()));
    return { created: true };
  });
});
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const assertNoDirectKeyNoBase64 = () => {
  expect(sentUrls().every(u => !u.includes("generativelanguage.googleapis.com"))).toBe(true);
  expect(sentHeaders().join("\n")).not.toContain("test-direct-gemini-key");
  expect(sentBodies().join("\n")).not.toContain("inlineData");
  expect(sentUrls().every(u => u.includes("gemini-3.8-flash") && !/gemini-[^/:]*pro/i.test(u))).toBe(true);
};

describe("剪辑方案分析（montage）两跳", () => {
  const plan = {
    sourceDurationSec: 5, summary: "原片结构", sourceSrt: "", uncertainties: [],
    plans: ["预告", "短版"].map(title => ({ title, kind: "short", rationale: "保留完整动作", cuts: [{ startSec: 0, endSec: 5, reason: "动作完成", evidence: "放下杯子" }] })),
    creativeDirections: ["回望", "观察"].map(title => ({ title, evidence: "放下杯子", difference: "改变讲述主体" })),
  };
  it("Vertex 空回 → EvoLink；gs:// 与签名 URL 各自送达；无 base64、无直连 key；存档顺序", async () => {
    fetchMock
      .mockResolvedValueOnce(geminiReply(""))
      .mockResolvedValueOnce(geminiReply(JSON.stringify({ answer: JSON.stringify(plan) })));
    const out = await askManhuaSubtitleReview(7, { videoUri: "gs://test/clip.mp4", dialogue: "已确认", montageTargetSec: 30 });
    expect(JSON.parse(JSON.parse(out).answer).plans).toHaveLength(2);
    expect(sentUrls()[0]).toContain("aiplatform.googleapis.com");
    expect(sentUrls()[1]).toContain("direct.evolink.ai");
    expect(JSON.parse(sentBodies()[0]).contents[0].parts[0].fileData).toEqual({ fileUri: "gs://test/clip.mp4", mimeType: "video/mp4" });
    expect(JSON.parse(sentBodies()[1]).contents[0].parts[0].fileData.fileUri).toMatch(/^https:\/\/signed\.example\/test\/clip\.mp4\?/);
    assertNoDirectKeyNoBase64();
    const prefix = h.upload.mock.calls[0][0].objectName.replace(/request\.json$/, "");
    expect(savedNames(prefix)).toEqual([
      "request.json", "hop-1-vertex-request.json", "hop-1-vertex-raw.json", "hop-1-vertex-rejected.json",
      "hop-2-evolink-request.json", "hop-2-evolink-raw.json", "hop-2-evolink-decoded.json", "hop-2-evolink-parsed.json", "hop-used.json",
      "montage-plan-parsed.json",
    ]);
    // 签名 URL 不入档
    expect(JSON.stringify(Array.from(h.store.values()))).not.toContain("X-Goog-Signature");
  });
  it("写坏（剪辑方案校验不过）也切下一跳；两跳都坏则失败，不降级为只看文字", async () => {
    fetchMock.mockResolvedValue(geminiReply(JSON.stringify({ answer: JSON.stringify({ ...plan, sourceDurationSec: 1 }) })));
    await expect(askManhuaSubtitleReview(7, { videoUri: "gs://test/clip.mp4", dialogue: "已确认", montageTargetSec: 30 })).rejects.toThrow("全部通道失败");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("MV 顾问独立听歌两跳 + 复用", () => {
  const evidence = (sourceKey: string) => JSON.stringify({ kind: "native_music_evidence_v1", sourceKey, summaryZh: "持续人声", sections: [{ startSec: 0, endSec: 12, labelZh: "主歌", heardZh: "人声", emotion: { fromZh: "平", toZh: "扬", triggerZh: "鼓", musicZh: "渐强", visualZh: "仅音频，未观察画面" } }], uncertaintiesZh: [] });
  const song = { gcsUri: "gs://test-bucket/song.wav", mimeType: "audio/wav", durationSec: 12, audioSha256: "b".repeat(64) };
  it("Vertex 超时 → EvoLink 签名 URL；只送歌曲不送剧情；解析结果单独存档；同一首歌第二次不重复听", async () => {
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(geminiReply(evidence(`song:${song.audioSha256}`)));
    const first = await hearSongIndependently(song);
    expect([first.channel, first.model, first.reused, first.audioTokens]).toEqual(["EvoLink", SONG_HEARING_MODEL, false, 40]);
    expect(JSON.parse(sentBodies()[0]).contents[0].parts[0].fileData.fileUri).toBe("gs://test-bucket/song.wav");
    expect(JSON.parse(sentBodies()[1]).contents[0].parts[0].fileData.fileUri).toMatch(/^https:\/\/signed\.example\/test-bucket\/song\.wav\?/);
    const prompt = JSON.parse(JSON.parse(sentBodies()[0]).contents[0].parts[1].text);
    expect(Object.keys(prompt).sort()).toEqual(["audioDurationSec", "sourceKey", "task"]);
    assertNoDirectKeyNoBase64();
    const attempt = `${first.evidencePrefix}/`;
    expect(savedNames(attempt)).toEqual([
      "hop-1-vertex-request.json", "hop-1-vertex-error.json",
      "hop-2-evolink-request.json", "hop-2-evolink-raw.json", "hop-2-evolink-decoded.json", "hop-2-evolink-parsed.json", "hop-used.json",
    ]);
    expect(h.store.get(first.cacheObject)).toMatchObject({ channel: "EvoLink", audioTokens: 40 });
    // 复用：真实读取存档（替身 readJson 读同一存储），不再调模型
    const again = await hearSongIndependently(song, {
      listen: geminiAudioJsonWithFallback, sign: u => u, upload: h.upload as any,
      readJson: async name => h.store.get(name), bucket: () => "test-bucket", uuid: () => "x",
    });
    expect(again.reused).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("无 AUDIO token 回执算写坏换下一跳", async () => {
    fetchMock.mockResolvedValueOnce(geminiReply(evidence(`song:${song.audioSha256}`), 0)).mockResolvedValueOnce(geminiReply(evidence(`song:${song.audioSha256}`)));
    const r = await hearSongIndependently(song);
    expect(r.channel).toBe("EvoLink");
  });
});

describe("演唱者标签按现有字段判断", () => {
  it("本人上传形象作歌手 → 男歌手（用户本人）；否则沿用原标签", () => {
    expect(performerLabelZh("男", { creativePrompt: "男声民谣，我本人出镜演唱", referenceSummaries: [] })).toBe("男歌手（用户本人）");
    expect(performerLabelZh("男", { creativePrompt: "男声民谣", referenceSummaries: ["本人-歌手.jpg"] })).toBe("男歌手（用户本人）");
    expect(performerLabelZh("男", { creativePrompt: "男声民谣，女主在雨中", referenceSummaries: ["女主.png"] })).toBe("男歌手（演唱者，与叙事主角分开）");
    expect(isPerformerTheUser({ creativePrompt: "歌手是我自己" })).toBe(true);
  });
});

describe("1110 EvoLink 跳只收签名 https（同模板学习做法）", () => {
  const base = (evolinkFileUri: () => string) => ({
    media: { vertexFileUri: "gs://test-bucket/a.mp3", evolinkFileUri },
    mimeType: "audio/mpeg", prompt: "听", schemaName: "t", validate: (v: unknown) => v,
    save: async () => undefined,
  });
  it("Vertex 失败后 EvoLink 收到签名 https，请求体无 gs:// 与 inlineData", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockResolvedValueOnce(geminiReply("{\"ok\":1}"));
    const r = await geminiAudioJsonWithFallback(base(() => "https://signed.example/test-bucket/a.mp3?X-Goog-Signature=t"));
    expect(r.channel).toBe("EvoLink");
    const evo = sentBodies()[1]!;
    expect(evo).toContain("\"fileUri\":\"https://signed.example/");
    expect(evo).not.toContain("gs://");
    expect(evo).not.toContain("inlineData");
    expect(sentBodies()[0]).toContain("\"fileUri\":\"gs://test-bucket/a.mp3\"");
  });
  it("EvoLink 跳拿到 gs:// 时不发请求、记失败", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(geminiAudioJsonWithFallback(base(() => "gs://test-bucket/a.mp3"))).rejects.toThrow(/EvoLink 只收签名 https/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("1110 内联音频入参已删除：没给媒体（只给内联音频）直接拒绝，两跳都不发请求", async () => {
    // @ts-expect-error audioBase64 入参已删除且 media 必填 —— 「不内联」由类型保证
    await expect(geminiAudioJsonWithFallback({ audioBase64: "bXAz", mimeType: "audio/mpeg", prompt: "听", schemaName: "t", validate: (v: unknown) => v, save: async () => undefined })).rejects.toThrow(/不收内联音频/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("1110 即使夹带多余的 audioBase64，两跳请求体也只有 fileData（Vertex gs:// / EvoLink https），无 inlineData", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockResolvedValueOnce(geminiReply("{\"ok\":1}"));
    // @ts-expect-error audioBase64 不在入参类型里（若有人加回该入参，这里的类型检查会报「未使用的 ts-expect-error」）
    const r = await geminiAudioJsonWithFallback({ ...base(() => "https://signed.example/test-bucket/a.mp3?X-Goog-Signature=t"), audioBase64: "bXAz" });
    expect(r.channel).toBe("EvoLink");
    expect(sentBodies().join("\n")).not.toMatch(/inlineData|bXAz/);
    expect(JSON.parse(sentBodies()[0]!).contents[0].parts[0].fileData.fileUri).toBe("gs://test-bucket/a.mp3");
    expect(JSON.parse(sentBodies()[1]!).contents[0].parts[0].fileData.fileUri).toMatch(/^https:\/\//);
    expect(JSON.parse(sentBodies()[0]!).generationConfig).not.toHaveProperty("audioTimestamp");
  });
});

describe("1110 两跳缺省模型固定 gemini-3.8-flash（隔离探针发现缺省落到通道配置 3.6）", () => {
  it("不传 model 时两跳 URL 都是 gemini-3.8-flash，通道环境变量不生效", async () => {
    vi.stubEnv("MANHUA_AUDIO_VERTEX_MODEL", "gemini-3.6-flash");
    vi.stubEnv("MANHUA_AUDIO_EVOLINK_MODEL", "gemini-3.6-flash");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockResolvedValueOnce(geminiReply("{\"ok\":1}"));
    const r = await geminiAudioJsonWithFallback({
      media: { vertexFileUri: "gs://test-bucket/a.mp3", evolinkFileUri: () => "https://signed.example/test-bucket/a.mp3?X-Goog-Signature=t" },
      mimeType: "audio/mpeg", prompt: "听", schemaName: "t", validate: (v: unknown) => v, save: async () => undefined,
    });
    expect(r.model).toBe("gemini-3.8-flash");
    expect(sentUrls()).toHaveLength(2);
    expect(sentUrls().every(u => u.includes("/models/gemini-3.8-flash:"))).toBe(true);
  });
});
