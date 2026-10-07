import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchPostProdSourceToFile, runMediaTool, uploadResult, type PostProdRunOptions } from "./postProduction";
import { uploadBufferToGcs } from "./gcs";
import { parseVfxVideoProbe } from "./manhuaVfxRender";
import { concatParamsSchema, type ConcatParams } from "../jobs/postProdInput";
export function buildTransitionPlan(input: ConcatParams, sources: Array<{ filePath: string; durationSec: number; hasAudio: boolean }>, output: string) {
  input = concatParamsSchema.parse(input);
  if (!input.transition || sources.length < 2 || sources.length > 6) throw new Error("转场拼接支持2至6段");
  const { width, height, fps } = input;
  if (width * height > 1920 * 1080) throw new Error("转场拼接最高支持1080p");
  const duration = Math.round(input.transition.durationSec * fps) / fps;
  if (!(duration > 0) || sources.some(s => !Number.isFinite(s.durationSec) || s.durationSec < 2 * duration + 1 / fps))
    throw new Error("每段时长须大于两倍转场时长，请缩短转场");
  const seconds = sources.map(s => Math.round(s.durationSec * fps) / fps);
  const expectedSec = seconds.reduce((a,b) => a+b,0) - duration * (sources.length-1);
  if (expectedSec > 120) throw new Error("转场拼接本次支持两分钟内成片");
  const args = ["-y"], chains: string[] = [];
  sources.forEach(s => args.push("-i", s.filePath));
  sources.forEach((s,i) => {
    chains.push(`[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,trim=duration=${seconds[i]},settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
    chains.push(s.hasAudio ? `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${seconds[i]},asetpts=PTS-STARTPTS[a${i}]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds[i]},asetpts=PTS-STARTPTS[a${i}]`);
  });
  let end = seconds[0], video = "v0", audio = "a0";
  for (let i=1;i<sources.length;i++) {
    chains.push(`[${video}][v${i}]xfade=transition=${input.transition.kind}:duration=${duration}:offset=${end-duration}[vx${i}]`);
    chains.push(`[${audio}][a${i}]acrossfade=d=${duration}:c1=tri:c2=tri[ax${i}]`);
    video=`vx${i}`; audio=`ax${i}`; end+=seconds[i]-duration;
  }
  args.push("-filter_complex", chains.join(";"), "-map", `[${video}]`, "-map", `[${audio}]`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", output);
  return { args, durationSec: expectedSec, transitionSec: duration };
}
const real = { fetch: fetchPostProdSourceToFile, run: runMediaTool, upload: uploadBufferToGcs, result: uploadResult };
export async function renderManhuaTransitions(input: ConcatParams, userId: string, options?: PostProdRunOptions, deps=real) {
  input = concatParamsSchema.parse(input);
  const signal = options?.signal || new AbortController().signal;
  const dir = await mkdtemp(path.join(tmpdir(), "manhua-transitions-"));
  const prefix = `post-prod/${userId.replace(/[^a-zA-Z0-9_-]/g, "")}/transition-evidence/${randomUUID()}`;
  const evidence: Array<{gcsUri:string; bytes:number; sha256:string}> = [];
  let archived = true;
  const save = async (name: string, buffer: Buffer) => {
    try {
      await writeFile(path.join(dir,name),buffer);
      const receipt=await deps.upload({objectName:`${prefix}/${name}`,buffer,contentType:"application/json",signal:AbortSignal.timeout(60_000)});
      evidence.push({gcsUri:receipt.gcsUri,bytes:buffer.length,sha256:createHash("sha256").update(buffer).digest("hex")});
    } catch(error) {archived=false;throw error;}
  };
  const probe = async (file: string, name: string) => {
    const raw = await deps.run("ffprobe",["-v","error","-show_format","-show_streams","-of","json",file],signal);
    await save(`${name}.raw.json`,Buffer.from(raw.stdout));
    await save(`${name}.parsed.json`,Buffer.from(JSON.stringify(JSON.parse(raw.stdout))));
    const meta=parseVfxVideoProbe(raw.stdout);
    await save(`${name}.normalized.json`,Buffer.from(JSON.stringify(meta)));return meta;
  };
  try {
    await save("request.json",Buffer.from(JSON.stringify(input)));
    if (!input.transition || input.clips.length>6) throw new Error("转场拼接支持2至6段");
    const sources=[]; const budget={remainingBytes:1536*1024*1024};
    for (let i=0;i<input.clips.length;i++) {
      const filePath=path.join(dir,`source-${i}.mp4`);
      await deps.fetch(input.clips[i],filePath,{signal,budget});
      sources.push({filePath,...await probe(filePath,`source-${i}`)});
    }
    const out=path.join(dir,"result.mp4"),plan=buildTransitionPlan(input,sources,out);
    await save("plan.json",Buffer.from(JSON.stringify(plan)));
    await deps.run("ffmpeg",plan.args,signal);
    const meta=await probe(out,"output");
    if(meta.width!==input.width||meta.height!==input.height||!meta.hasAudio||Math.abs(meta.durationSec-plan.durationSec)>1/input.fps+.001)
      throw new Error("转场成片画幅、音轨或时长不一致，未采用结果");
    const uploaded=await deps.result({filePath:out,userId,kind:"concat",ext:"mp4",contentType:"video/mp4",signal});
    const result={...uploaded,durationSec:meta.durationSec,clipCount:input.clips.length,transition:input.transition,evidence};
    await save("result.json",Buffer.from(JSON.stringify(result)));return result;
  } catch(error) {
    await save("failure.json",Buffer.from(JSON.stringify({error:error instanceof Error?error.message:"unknown"}))).catch(()=>{archived=false;});
    throw error;
  } finally {if(archived)await rm(dir,{recursive:true,force:true});}
}
