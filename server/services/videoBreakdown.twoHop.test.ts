import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 拉片看片两跳（离线替身，不发真实请求）：Vertex gs:// → EvoLink 签名 https；
 * 超时 / 写坏（含修复重写仍不过）/ 空回 都切下一跳；写坏首发后同跳带原因修复重写一次；
 * 请求体不内联媒体，Vertex 带 videoMetadata.fps；每跳原始与解析 JSON 分别落档。
 */
vi.mock("../services/vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));

import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { videoBreakdownFixture } from "./videoBreakdown.fixture";
import {
  VIDEO_BREAKDOWN_NATIVE_SCHEMA,
  buildVideoBreakdownPrompt,
  buildVideoBreakdownRepairPrompt,
  parseAndFixVideoBreakdown,
  resolveVideoBreakdownModel,
} from "./videoBreakdown";

const fetchMock = vi.fn();
const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
const good = () => reply(JSON.stringify(videoBreakdownFixture()));
const badTiming = () => {
  const v = videoBreakdownFixture();
  v.segments[1]!.startSec = 14; // 缺口 4 秒，超出吸附范围
  return reply(JSON.stringify(v));
};
const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const isVertex = (url: unknown) => String(url).includes("aiplatform.googleapis.com");

function run() {
  const saved = new Map<string, unknown>();
  const basePrompt = buildVideoBreakdownPrompt({ durationSec: 30 });
  const promise = geminiAudioJsonWithFallback({
    media: { vertexFileUri: "gs://test-bucket/uploads/u42/video-breakdown/a.mp4", evolinkFileUri: () => "https://signed.example/a.mp4?X-Goog-Signature=t" },
    mimeType: "video/mp4",
    model: resolveVideoBreakdownModel(),
    prompt: basePrompt,
    nativeSchema: VIDEO_BREAKDOWN_NATIVE_SCHEMA,
    schemaName: "video_breakdown_v1",
    validate: v => parseAndFixVideoBreakdown(v, 30),
    repairPrompt: (reason, bad) => buildVideoBreakdownRepairPrompt(basePrompt, reason, bad),
    save: async (name, value) => { saved.set(name, value); },
    videoFps: 2,
  });
  return { promise, saved };
}
const bodies = () => fetchMock.mock.calls.map(c => JSON.parse(String((c[1] as RequestInit).body)));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  vi.stubEnv("VIDEO_BREAKDOWN_MODEL", "");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
});
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("拉片看片两跳切换", () => {
  it("Vertex 超时 → EvoLink 成功", async () => {
    fetchMock.mockImplementation(async (url: unknown) => { if (isVertex(url)) throw timeoutError(); return good(); });
    const { promise, saved } = run();
    const out = await promise;
    expect(out.channel).toBe("EvoLink");
    expect(out.failuresZh[0]).toContain("请求超时");
    expect(saved.has("hop-1-vertex-error")).toBe(true);
    expect(saved.has("hop-2-evolink-raw")).toBe(true);
    expect(saved.has("hop-2-evolink-parsed")).toBe(true);
    // 不内联；Vertex 读 gs://（带 fps），EvoLink 读签名 https；模型不写死
    const [vx, evo] = bodies();
    expect(JSON.stringify(bodies())).not.toContain("inlineData");
    expect(vx.contents[0].parts[0]).toEqual({ fileData: { mimeType: "video/mp4", fileUri: "gs://test-bucket/uploads/u42/video-breakdown/a.mp4" }, videoMetadata: { fps: 2 } });
    expect(evo.contents[0].parts[0].fileData.fileUri).toMatch(/^https:\/\//);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("gemini-3.8-flash");
    expect(String(fetchMock.mock.calls.map(c => c[0]).join())).not.toContain("generativelanguage.googleapis.com");
  });

  it("Vertex 写坏（首发与修复重写都不过）→ EvoLink 成功；修复请求带原因与上次输出", async () => {
    fetchMock.mockImplementation(async (url: unknown) => (isVertex(url) ? badTiming() : good()));
    const { promise, saved } = run();
    const out = await promise;
    expect(out.channel).toBe("EvoLink");
    expect(fetchMock.mock.calls.filter(c => isVertex(c[0]))).toHaveLength(2);
    expect(saved.has("hop-1-vertex-rejected")).toBe(true);
    expect(saved.has("hop-1-vertex-repair-request")).toBe(true);
    expect(saved.has("hop-1-vertex-repair-rejected")).toBe(true);
    const repairPrompt = bodies()[1].contents[0].parts.at(-1).text as string;
    expect(repairPrompt).toContain("【修复重写】");
    expect(repairPrompt).toContain("第2段与上一段不相接");
    expect(out.failuresZh.join()).toContain("Vertex·修复");
  });

  it("Vertex 空回 → EvoLink 成功（空回不修复重写）", async () => {
    fetchMock.mockImplementation(async (url: unknown) => (isVertex(url) ? reply("") : good()));
    const { promise, saved } = run();
    const out = await promise;
    expect(out.channel).toBe("EvoLink");
    expect(out.failuresZh[0]).toContain("空回");
    expect(fetchMock.mock.calls.filter(c => isVertex(c[0]))).toHaveLength(1);
    expect(saved.has("hop-1-vertex-repair-request")).toBe(false);
  });

  it("Vertex 首发写坏、修复重写通过 → 不切下一跳", async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => (n++ === 0 ? reply("{not json") : good()));
    const { promise, saved } = run();
    const out = await promise;
    expect(out.channel).toBe("Vertex");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saved.get("hop-used")).toMatchObject({ channel: "Vertex", repaired: true });
    expect(saved.has("hop-1-vertex-repair-parsed")).toBe(true);
  });

  it("只有可选块坏（craft 不合格、keyMoments 越界）：同跳直接采用，不修复重写、不切跳", async () => {
    const v = videoBreakdownFixture() as any;
    v.overview = { ...v.overview, craft: { styleTags: "x" }, keyMoments: [{ atSec: 99, type: "cut", note: "越界" }, { atSec: 3, type: "cut", note: "切近景" }] };
    fetchMock.mockImplementation(async () => reply(JSON.stringify(v)));
    const { promise, saved } = run();
    const out = await promise;
    expect(out.channel).toBe("Vertex");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saved.has("hop-1-vertex-repair-request")).toBe(false);
    expect(out.value.overview.craft).toBeUndefined();
    expect(out.value.overview.keyMoments).toEqual([{ atSec: 3, type: "cut", note: "切近景" }]);
  });

  it("两跳都失败：抛错并记 hop-exhausted", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));
    const { promise, saved } = run();
    await expect(promise).rejects.toThrow();
    expect(saved.has("hop-exhausted")).toBe(true);
  });
});
