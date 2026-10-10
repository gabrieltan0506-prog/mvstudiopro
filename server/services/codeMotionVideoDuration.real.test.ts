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

it("production consumer fills short media and trims long media without altering the input", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "ink-duration-fixture-"));
  try {
    for (const seconds of [1, 4.6, 6]) {
      input.file = path.join(scratch, `source-${seconds}.mp4`);
      execFileSync("ffmpeg", ["-v","error","-f","lavfi","-i",`color=c=blue:s=64x64:r=24:d=${seconds}`,"-c:v","libx264","-pix_fmt","yuv420p",input.file]);
      const hash = createHash("sha256").update(await readFile(input.file)).digest("hex");
      const dir = await mkdtemp(path.join(scratch,"frames-"));
      const receipts = new Map<string,Buffer>();
      const frames = await prepareCodeMotionVideoFrames({version:1,assets:[{id:"source",videoUri:"gs://fixture/source.mp4",sha256:hash,durationSec:5}],clips:[{assetId:"source",at:0,duration:5,sourceStartSec:0,fit:"cover"}]},{width:64,height:64,fps:30},dir,new AbortController().signal,async(n,b)=>{receipts.set(n,b);});
      expect(frames.size).toBe(150);
      expect(createHash("sha256").update(await readFile(input.file)).digest("hex")).toBe(hash);
      expect(JSON.parse(receipts.get("video-clip-0.parsed.json")!.toString()).normalization).toBe(seconds < 5 ? "hold_last_frame" : "trim_to_timeline");
      console.log(JSON.stringify({regressionFixture:true,seconds,decodedFrames:frames.size,unchangedInput:true}));
    }
  } finally { await rm(scratch,{recursive:true,force:true}); }
}, 60000);


const handoff = process.env.INK_HANDOFF_VIDEO_PROBE;
it.skipIf(!handoff)("decodes the new paid coffee handoff original without manually trimming provider bytes", async () => {
  input.file = handoff!;
  const hash = createHash("sha256").update(await readFile(input.file)).digest("hex");
  expect(hash).toBe("b17a8008b96c4fd5dff35b63642f311a81856ba12aec3e5fb87ebf1d82634592");
  const dir = await mkdtemp(path.join(tmpdir(), "ink-handoff-"));
  try {
    const receipts = new Map<string, Buffer>();
    const frames = await prepareCodeMotionVideoFrames({ version: 1,
      assets: [{ id: "handoff", videoUri: "gs://fixture/handoff.mp4", sha256: hash, durationSec: 5 }],
      clips: [{ assetId: "handoff", at: 5, duration: 5, sourceStartSec: 0, fit: "cover" }]
    }, { width: 180, height: 320, fps: 30 }, dir, new AbortController().signal, async(n,b) => { receipts.set(n,b); });
    expect(frames.size).toBe(150);
    expect(createHash("sha256").update(await readFile(input.file)).digest("hex")).toBe(hash);
    const receipt = JSON.parse(receipts.get("video-clip-0.parsed.json")!.toString());
    expect(receipt.normalization).toBe("trim_to_timeline");
    console.log(JSON.stringify({ inputSha256: hash, decodedFrames: frames.size, receipt, unchangedProviderOriginal: true }));
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);

it("paid8-second formal consumer decodes240 frames from an unmodified8.04-second source",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"ink-eight-second-"));
 try{
  input.file=path.join(dir,"original.mp4");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=64x64:rate=25:duration=8.04","-c:v","libx264","-pix_fmt","yuv420p",input.file]);
  const bytes=await readFile(input.file),sha256=createHash("sha256").update(bytes).digest("hex"),receipts=new Map<string,Buffer>();
  const frames=await prepareCodeMotionVideoFrames({version:1,assets:[{id:"paid-eight",videoUri:"gs://fixture/paid-eight.mp4",sha256,durationSec:8}],clips:[{assetId:"paid-eight",at:0,duration:8,sourceStartSec:0,fit:"cover"}]},{width:64,height:64,fps:30},dir,new AbortController().signal,async(n,b)=>{receipts.set(n,b);});
  expect(frames.size).toBe(240);expect(await readFile(input.file)).toEqual(bytes);expect(JSON.parse(receipts.get("video-clip-0.parsed.json")!.toString()).normalization).toBe("trim_to_timeline");
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
