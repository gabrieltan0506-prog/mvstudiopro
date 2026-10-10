import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { codeMotionVideoSchema, validateCodeMotionVideo } from "../../shared/codeMotionVideo";

const local = vi.hoisted(() => ({
  file: "",
  calls: [] as Array<{ tool: string; args: string[] }>,
}));
// Only substitute the cloud fetch boundary with a byte-for-byte local copy.
// ffprobe/ffmpeg below are real binaries, not simulated media or schema results.
vi.mock("./postProduction", () => ({
  fetchPostProdSourceToFile: async (_uri: string, target: string) => copyFile(local.file, target),
  runMediaTool: async (tool: string, args: string[]) => {
    local.calls.push({ tool, args });
    return { stdout: execFileSync(tool, args, { encoding: "utf8" }) };
  },
}));
import { prepareCodeMotionVideoFrames } from "./codeMotionVideoFrames";

const original = process.env.INK_DIALOGUE_PROVIDER_ORIGINAL;
const evidence = process.env.INK_DIALOGUE_CONSUMER_EVIDENCE;
const expectedSha = "948c930cef833217adf38843f8aaadd87d31aeeffb5725e2647c4429e4769b21";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

it.skipIf(!original || !evidence)("adopts the real eight-second dialogue original as 240 frames without changing provider bytes", async () => {
  local.file = original!;
  local.calls.length = 0;
  const before = await readFile(local.file);
  expect(hash(before)).toBe(expectedSha);
  await mkdir(evidence!, { recursive: true });
  const root = await mkdtemp(path.join(evidence!, "decode-"));
  const video = codeMotionVideoSchema.parse({
    version: 1,
    assets: [{
      id: "paid-dialogue-original",
      videoUri: "gs://mv-studio-pro-vertex-video-temp/code-motion/probes/pr1697-paid-3d-20261010/dialogue/provider-original.mp4",
      sha256: expectedSha,
      durationSec: 8,
    }],
    clips: [{ assetId: "paid-dialogue-original", at: 5, duration: 8, sourceStartSec: 0, fit: "cover" }],
  });
  expect(validateCodeMotionVideo(video, 33, 30)).toEqual([]);
  const receipts = new Map<string, Buffer>();
  const frames = await prepareCodeMotionVideoFrames(video, { width: 180, height: 320, fps: 30 }, root,
    new AbortController().signal, async (name, bytes) => {
      receipts.set(name, bytes);
      await writeFile(path.join(evidence!, name), bytes);
    });
  expect(frames.size).toBe(240);
  expect(Array.from(frames.keys())).toEqual(Array.from({ length: 240 }, (_, index) => index + 150));
  const identity = JSON.parse(receipts.get("video-source-0.identity.json")!.toString());
  const clip = JSON.parse(receipts.get("video-clip-0.parsed.json")!.toString());
  expect(identity.sha256).toBe(expectedSha);
  expect(identity.sourceAudio).toBe("muted");
  expect(clip).toMatchObject({ frameCount: 240, firstFrame: 150, normalization: "trim_to_timeline", paddedSeconds: 0, audio: "muted" });
  expect(clip.actualSourceDuration).toBeCloseTo(8.041667, 6);
  expect(await readFile(local.file)).toEqual(before);
  expect(hash(await readFile(path.join(root, "video-source-0.mp4")))).toBe(expectedSha);
  expect(local.calls.find(call => call.tool === "ffmpeg")?.args).toContain("-an");
  const report = {
    pass: true,
    classification: "real generated original through production schema and prepareCodeMotionVideoFrames; local storage adapter plus real ffmpeg; no authenticated ownership or cloud route assertion",
    inputSha256: expectedSha,
    providerTaskId: "task-unified-1791670053-um8bwqtu",
    unchangedProviderOriginal: true,
    decodedFrames: frames.size,
    outputTimeline: { firstFrame: 150, lastFrameInclusive: 389, fps: 30, at: 5, duration: 8 },
    firstFrameSha256: hash(await readFile(frames.get(150)!)),
    lastFrameSha256: hash(await readFile(frames.get(389)!)),
    clip,
    commands: local.calls,
    framesDirectory: root,
  };
  await writeFile(path.join(evidence!, "consumer-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}, 60000);
