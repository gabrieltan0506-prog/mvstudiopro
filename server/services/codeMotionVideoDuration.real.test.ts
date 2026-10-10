import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { codeMotionVideoDurationMatches } from "./codeMotionVideoDuration";
const input = vi.hoisted(() => ({ file: "" }));
vi.mock("./postProduction", () => ({
  fetchPostProdSourceToFile: async (_uri: string, target: string) => copyFile(input.file, target),
  runMediaTool: async (tool: string, args: string[]) => ({ stdout: execFileSync(tool, args, { encoding: "utf8" }) }),
}));
import { prepareCodeMotionVideoFrames } from "./codeMotionVideoFrames";
const root = process.env.INK_EXISTING_VIDEO_PROBE_ROOT;
it.skipIf(!root)("decodes the four unmodified provider originals through the production consumer", async () => {
  for (const tier of ["free", "paid"]) for (const scene of [2, 3]) {
    input.file = path.join(root!, "videos", tier, `scene-${scene}`, "output.mp4");
    const hash = createHash("sha256").update(await readFile(input.file)).digest("hex");
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", input.file], { encoding: "utf8" }));
    const stream = probe.streams.find((s: any) => s.codec_type === "video");
    expect(codeMotionVideoDurationMatches(Number(stream.duration ?? probe.format.duration), 5)).toBe(true);
    const dir = await mkdtemp(path.join(tmpdir(), "ink-duration-"));
    try {
      const receipts = new Map<string, Buffer>();
      const frames = await prepareCodeMotionVideoFrames({version:1,assets:[{id:"original",videoUri:"gs://fixture/original.mp4",sha256:hash,durationSec:5}], clips:[{assetId:"original",at:0,duration:5,sourceStartSec:0,fit:"cover"}]}, {width:180,height:320,fps:30},dir,new AbortController().signal,async (n,b) => {receipts.set(n,b);});
      expect(frames.size).toBe(150);
      expect(JSON.parse(receipts.get("video-source-0.identity.json")!.toString()).sha256).toBe(hash);
      console.log(JSON.stringify({tier,scene,originalSha256:hash,streamDuration:stream.duration,containerDuration:probe.format.duration,decodedFrames:frames.size}));
    } finally { await rm(dir, {recursive:true,force:true}); }
  }
}, 60000);
