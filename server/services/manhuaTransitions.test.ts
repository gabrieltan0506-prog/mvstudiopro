import { expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildTransitionPlan, renderManhuaTransitions } from "./manhuaTransitions";
import { runMediaTool } from "./postProduction";
import type { ConcatParams } from "../jobs/postProdInput";
const input: ConcatParams = { clips: ["gs://offline/a.mp4","gs://offline/b.mp4"], width: 320, height: 240, fps: 24, transition: { kind: "fade", durationSec: .5 } };
it("rejects overlapping transition windows and unsupported filter input", () => {
 const sources = [0,1].map(i=>({filePath:`${i}.mp4`,durationSec:2,hasAudio:false}));
 expect(buildTransitionPlan(input,sources,"out.mp4").durationSec).toBe(3.5);
 expect(()=>buildTransitionPlan({...input,transition:{kind:"fade",durationSec:1}},sources,"out.mp4")).toThrow("两倍");
 expect(()=>buildTransitionPlan({...input,transition:{kind:"bad;filter" as "fade",durationSec:.5}},sources,"out.mp4")).toThrow();
 for (const kind of ["dissolve","wipeleft"] as const) expect(buildTransitionPlan({...input,transition:{kind,durationSec:.5}},sources,"out.mp4").args.join(" ")).toContain(`transition=${kind}`);
});
it("renders real crossfade pixels and correct overlapping duration while preserving raw probes before parsing", async () => {
 const dir = await mkdtemp(path.join(tmpdir(),"manhua-transition-evidence-")),signal=AbortSignal.timeout(60_000);
 const a=path.join(dir,"a.mp4"),b=path.join(dir,"b.mp4"),out=path.join(dir,"output.mp4");
 for(const [file,color] of [[a,"red"],[b,"blue"]]) await runMediaTool("ffmpeg",["-y","-f","lavfi","-i",`color=${color}:s=320x240:r=24:d=2`,"-c:v","libx264","-pix_fmt","yuv420p",file],signal);
 const archived:string[]=[];
 const result=await renderManhuaTransitions(input,"7",{signal},{
  fetch:async(uri,target)=>{await copyFile(uri.endsWith("a.mp4")?a:b,target);return (await stat(target)).size;}, run:runMediaTool,
  upload:async({objectName,buffer})=>{const name=path.basename(objectName);archived.push(name);await writeFile(path.join(dir,name),buffer);return {bucket:"offline",objectName,gcsUri:`gs://offline/${objectName}`};},
  result:async p=>{await copyFile(p.filePath,out);return {gcsUri:"gs://offline/out.mp4",url:"https://example.invalid/out.mp4",bytes:(await stat(out)).size};},
 });
 expect(result.durationSec).toBeCloseTo(3.5,2);
 expect(archived.indexOf("source-0.raw.json")).toBeLessThan(archived.indexOf("source-0.parsed.json"));
 const png=path.join(dir,"middle.png");await runMediaTool("ffmpeg",["-v","error","-ss","1.75","-i",out,"-frames:v","1",png],signal);
 const pixel=await sharp(png).extract({left:160,top:120,width:1,height:1}).raw().toBuffer();
 expect(pixel[0]).toBeGreaterThan(50);expect(pixel[2]).toBeGreaterThan(50);expect(pixel[1]).toBeLessThan(20);
 await writeFile("docs/evidence/manhua-vfx-1007/transition-receipt.json",JSON.stringify({boundary:"synthetic real ffmpeg; injected cloud; not workflow acceptance",dir,result,pixel:Array.from(pixel),archived},null,2));
},90_000);
