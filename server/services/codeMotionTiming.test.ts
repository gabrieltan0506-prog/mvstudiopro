import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("./vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer vertex-test-token" })),
  getVertexProjectId: () => "test-project",
}));

import { geminiAudioJsonWithFallback } from "../gemini-audio";
import {
  analyzeCodeMotionTiming,
  resolveCodeMotionTimingModel,
  type CodeMotionTimingDeps,
} from "./codeMotionTiming";

const fetchMock = vi.fn();
beforeEach(() => {
  // 只用替身：真实 fetch 一律不发（不做任何付费调用）。
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"type\":\"test\"}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-key");
  vi.stubEnv("MANHUA_AUDIO_VERTEX_LOCATION", "global");
  vi.stubEnv("MANHUA_AUDIO_EVOLINK_BASE_URL", "https://evolink.test");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
  vi.stubEnv("CODE_MOTION_TIMING_MODEL", "");
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const gem = (text: string, modelVersion = "gemini-3.8-flash") =>
  new Response(
    JSON.stringify({
      modelVersion,
      usageMetadata: { promptTokenCount: 12 },
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    }),
    { status: 200 }
  );
const goodTiming = JSON.stringify({
  words: [
    {
      id: "word",
      text: "跳跃",
      startSec: 0.37,
      endSec: 0.83,
      confidence: 0.8,
      action: "pop",
    },
  ],
  beats: [{ id: "beat", at: 0.52, strength: 0.9 }],
});
const sentBody = (call: number) =>
  JSON.parse(String(fetchMock.mock.calls[call]![1]!.body));
const bytes = Buffer.from("actual-source"),
  source = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "原音",
    gcsUri: "gs://fixture/owned.wav",
    duration: 50,
    mimeType: "audio/wav" as const,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
const input = {
  projectId: "11111111-1111-4111-8111-111111111111",
  grantId: "33333333-3333-4333-8333-333333333333",
  source,
  windowStart: 12,
  windowDuration: 8,
};
function fixture() {
  const files = new Map<string, { body: Buffer; generation: string }>();
  const archived = new Map<string, Buffer>();
  let revision = 0;
  const deps: CodeMotionTimingDeps = {
    storage: {
      read: async n => files.get(n) || null,
      write: async (n, b, g) => {
        if ((files.get(n)?.generation || "0") !== g)
          throw Error("CAS conflict");
        const next = String(++revision);
        files.set(n, { body: b, generation: next });
        return next;
      },
      list: async () => Array.from(files.keys()),
    },
    ownership: vi.fn(async () => {}),
    reserve: vi.fn(async () => ({}) as any),
    assert: vi.fn(async () => ({}) as any),
    read: vi.fn(async () => bytes),
    window: vi.fn(async () => Buffer.from("RIFF-short-8-second-window")),
    bucket: () => "fixture",
    listen: vi.fn(geminiAudioJsonWithFallback) as any,
    archive: vi.fn(async (name: string, b: Buffer) => {
      archived.set(name, b);
      return `gs://fixture/${name}`;
    }),
    sign: vi.fn(
      (gsUri: string) =>
        `https://signed.test/${gsUri.slice(5)}?X-Goog-Signature=abc`
    ),
  };
  const json = (suffix: string) =>
    JSON.parse(
      files
        .get(Array.from(files.keys()).find(n => n.endsWith(suffix))!)!
        .body.toString()
    );
  return { deps, files, archived, json };
}
it("1110 通道合规：秒窗先存 GCS，首跳 Vertex 读 gs://（无 inlineData），映射原音秒数，恢复不再调用", async () => {
  fetchMock.mockResolvedValueOnce(gem(goodTiming));
  const { deps, files, archived, json } = fixture();
  const result = await analyzeCodeMotionTiming("12", input, deps);
  expect(result.timing.review).toBe("needs-review");
  expect(result.timing.words[0].startSec).toBe(12.37);
  expect(result.timing.evidence?.model).toBe("gemini-3.8-flash");
  expect(deps.window).toHaveBeenCalledWith(bytes, 12, 8);
  const windowName = Array.from(archived.keys())[0]!;
  expect(windowName).toMatch(/\/timing\/[0-9a-f-]+\/window-[0-9a-f]{64}\.wav$/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toBe(
    "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent"
  );
  const parts = sentBody(0).contents[0].parts;
  expect(parts[0]).toEqual({
    fileData: { mimeType: "audio/wav", fileUri: `gs://fixture/${windowName}` },
  });
  expect(JSON.stringify(sentBody(0))).not.toContain("inlineData");
  expect(JSON.stringify(sentBody(0))).not.toContain(
    Buffer.from("RIFF-short-8-second-window").toString("base64")
  );
  expect(deps.sign).not.toHaveBeenCalled();
  // 每跳原始与解析分别落档；采用的 raw 另存，指针仍是 raw.json。
  const names = Array.from(files.keys()).map(n => n.split("/").pop());
  expect(names).toEqual(
    expect.arrayContaining([
      "manifest.json",
      "hop-1-vertex-request.json",
      "hop-1-vertex-raw.json",
      "hop-1-vertex-decoded.json",
      "hop-1-vertex-parsed.json",
      "raw.json",
    ])
  );
  expect(json("hop-1-vertex-request.json").mediaGsUri).toBe(
    `gs://fixture/${windowName}`
  );
  expect(json("manifest.json")).toMatchObject({
    status: "succeeded",
    model: "gemini-3.8-flash",
    channel: "Vertex",
  });
  expect(JSON.stringify(Array.from(files.values()).map(f => f.body.toString()))).not.toContain(
    "X-Goog-Signature"
  );
  expect((await analyzeCodeMotionTiming("12", input, deps)).reused).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("首跳写坏 → 备跳 EvoLink 只收签名 https；全部失败给中性报错且不自动重做", async () => {
  fetchMock
    .mockResolvedValueOnce(gem("{not json"))
    .mockResolvedValueOnce(gem(goodTiming));
  const { deps, json } = fixture();
  const result = await analyzeCodeMotionTiming("12", input, deps);
  expect(result.timing.words[0].endSec).toBeCloseTo(12.83);
  expect(String(fetchMock.mock.calls[1]![0])).toBe(
    "https://evolink.test/v1beta/models/gemini-3.8-flash:generateContent"
  );
  expect(sentBody(1).contents[0].parts[0].fileData.fileUri).toMatch(
    /^https:\/\/signed\.test\/.+window-[0-9a-f]{64}\.wav\?X-Goog-Signature=abc$/
  );
  expect(json("manifest.json")).toMatchObject({ channel: "EvoLink" });
  expect(json("hop-1-vertex-rejected.json").reasonZh).toContain("写坏");

  fetchMock.mockReset();
  fetchMock
    .mockRejectedValueOnce(Object.assign(Error("timeout after possible charge"), { name: "TimeoutError" }))
    .mockResolvedValueOnce(new Response("{}", { status: 500 }));
  const failed = fixture();
  await expect(analyzeCodeMotionTiming("12", input, failed.deps)).rejects.toThrow(
    /^听音分析未成功.*不自动重做/
  );
  const manifest = failed.json("manifest.json");
  expect(manifest.status).toBe("failed");
  expect(manifest.error).toContain("全部通道失败");
  await expect(analyzeCodeMotionTiming("12", input, failed.deps)).rejects.toThrow(
    /不自动重做/
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("rejects >30 seconds and changed source bytes without any provider call", async () => {
  const { deps } = fixture();
  await expect(
    analyzeCodeMotionTiming("12", { ...input, windowDuration: 31 }, deps)
  ).rejects.toThrow();
  const other = fixture();
  vi.mocked(other.deps.read).mockResolvedValue(Buffer.from("changed"));
  await expect(
    analyzeCodeMotionTiming("12", input, other.deps)
  ).rejects.toThrow(/身份/);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(other.deps.archive).not.toHaveBeenCalled();
});
it("1110 模型不写死：CODE_MOTION_TIMING_MODEL 生效于新提交；已提交任务按回执绑定的模型恢复，改 env 不影响", async () => {
  expect(resolveCodeMotionTimingModel()).toBe("gemini-3.8-flash");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-4.0-flash");
  expect(resolveCodeMotionTimingModel()).toBe("gemini-4.0-flash");
  vi.stubEnv("CODE_MOTION_TIMING_MODEL", "gemini-3.9-flash");
  expect(resolveCodeMotionTimingModel()).toBe("gemini-3.9-flash");
  fetchMock.mockResolvedValueOnce(gem(goodTiming, "gemini-3.9-flash"));
  const { deps, json } = fixture();
  const first = await analyzeCodeMotionTiming("12", input, deps);
  expect(String(fetchMock.mock.calls[0]![0])).toContain(
    "/models/gemini-3.9-flash:generateContent"
  );
  expect(json("hop-1-vertex-request.json").model).toBe("gemini-3.9-flash");
  expect(json("manifest.json").model).toBe("gemini-3.9-flash");
  const slotDigest = vi.mocked(deps.reserve).mock.calls[0]![1].digest;
  vi.stubEnv("CODE_MOTION_TIMING_MODEL", "gemini-5.0-flash");
  const again = await analyzeCodeMotionTiming("12", input, deps);
  expect(again).toMatchObject({ reused: true, timing: first.timing });
  expect(vi.mocked(deps.reserve).mock.calls[1]![1].digest).toBe(slotDigest);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("1110 前旧回执（无 model 字段）按当时的 3.8 Flash 身份恢复，名额摘要不变", async () => {
  fetchMock.mockResolvedValueOnce(gem(goodTiming));
  const { deps, files } = fixture();
  const first = await analyzeCodeMotionTiming("12", input, deps);
  const legacyDigest = vi.mocked(deps.reserve).mock.calls[0]![1].digest;
  const manifestName = Array.from(files.keys()).find(n => n.endsWith("manifest.json"))!;
  const { model: _model, windowUri: _w, channel: _c, failuresZh: _f, ...legacy } = JSON.parse(
    files.get(manifestName)!.body.toString()
  );
  files.set(manifestName, { body: Buffer.from(JSON.stringify(legacy)), generation: "99" });
  vi.stubEnv("CODE_MOTION_TIMING_MODEL", "gemini-3.9-flash");
  const again = await analyzeCodeMotionTiming("12", input, deps);
  expect(again).toMatchObject({ reused: true, timing: first.timing });
  expect(vi.mocked(deps.reserve).mock.calls[1]![1].digest).toBe(legacyDigest);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("actually decodes and trims a bounded PCM window before any native call", async () => {
  const { execFileSync } = await import("node:child_process");
  const { trimCodeMotionTimingWindow } = await import("./codeMotionTiming");
  const source = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-ar",
    "48000",
    "-ac",
    "1",
    "-f",
    "wav",
    "-",
  ]);
  const result = await trimCodeMotionTimingWindow(source, 0.73, 0.5);
  expect(result.toString("ascii", 0, 4)).toBe("RIFF");
  const data = result.indexOf(Buffer.from("data"));
  expect(result.readUInt32LE(data + 4)).toBe(48000 * 0.5 * 2);
}, 15000);
