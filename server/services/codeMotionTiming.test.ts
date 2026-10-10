import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  analyzeCodeMotionTiming,
  type CodeMotionTimingDeps,
} from "./codeMotionTiming";
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
    generate: vi.fn(async () => ({
      text: JSON.stringify({
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
      }),
      modelVersion: "gemini-3.8-flash",
      usageMetadata: { promptTokenCount: 12 },
    })),
  };
  return { deps, files };
}
it("sends native bounded window, archives raw before parsing, maps source seconds and recovers without a second call", async () => {
  const { deps, files } = fixture();
  const result = await analyzeCodeMotionTiming("12", input, deps);
  expect(result.timing.review).toBe("needs-review");
  expect(result.timing.words[0].startSec).toBe(12.37);
  expect(deps.window).toHaveBeenCalledWith(bytes, 12, 8);
  const request = vi.mocked(deps.generate).mock.calls[0][0];
  expect(request.contents[0].parts[1].inlineData).toEqual({
    mimeType: "audio/wav",
    data: Buffer.from("RIFF-short-8-second-window").toString("base64"),
  });
  expect(Array.from(files.keys()).some(n => n.endsWith("raw.json"))).toBe(true);
  expect((await analyzeCodeMotionTiming("12", input, deps)).reused).toBe(true);
  expect(deps.generate).toHaveBeenCalledTimes(1);
});
it("rejects unknown call replay, >30 seconds, and changed source bytes without another provider call", async () => {
  const { deps } = fixture();
  vi.mocked(deps.generate).mockRejectedValueOnce(
    Error("timeout after possible charge")
  );
  await expect(analyzeCodeMotionTiming("12", input, deps)).rejects.toThrow(
    "timeout"
  );
  await expect(analyzeCodeMotionTiming("12", input, deps)).rejects.toThrow(
    /不自动重做/
  );
  expect(deps.generate).toHaveBeenCalledTimes(1);
  await expect(
    analyzeCodeMotionTiming("12", { ...input, windowDuration: 31 }, deps)
  ).rejects.toThrow();
  const other = fixture();
  vi.mocked(other.deps.read).mockResolvedValue(Buffer.from("changed"));
  await expect(
    analyzeCodeMotionTiming("12", input, other.deps)
  ).rejects.toThrow(/身份/);
  expect(other.deps.generate).not.toHaveBeenCalled();
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
