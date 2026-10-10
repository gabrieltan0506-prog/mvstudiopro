import {expect,it,vi} from "vitest";
import {mkdtemp,readFile,writeFile,copyFile,mkdir,rm} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
const h=vi.hoisted(()=>({files:new Map<string,Buffer>(),media:new Map<string,Buffer>()}));
vi.mock("./codeMotionRevisionEdit",()=>({inspectCodeMotionEditVideo:vi.fn(),editVideoCost:vi.fn()}));
vi.mock("./codeMotionProductionGrant",()=>({codeMotionProductionDigest:()=>"not-used-in-adoption"}));
vi.mock("./codeMotionStore",()=>({codeMotionStorage:{read:async(n:string)=>h.files.has(n)?{body:h.files.get(n),generation:"1"}:null,write:async(n:string,b:Buffer)=>{if(h.files.has(n))throw Error("CAS");h.files.set(n,b);return "1";}}}));
vi.mock("./gcs",()=>({signGcsObjectPathV4ReadUrl:()=>"https://fixture/unused",getGcsBucketName:()=>"fixture",uploadBufferToGcsIfAbsent:async(v:any)=>{h.media.set(`gs://fixture/${v.objectName}`,v.buffer);}}));
vi.mock("./canvasMediaOwnership",()=>({verifyCanvasMediaOwnership:async()=>true,registerCanvasMediaOwner:async()=>"created"}));
vi.mock("./postProduction",()=>({runMediaTool:async(tool:string,args:string[])=>({stdout:execFileSync(tool,args,{encoding:"utf8"}),stderr:""}),fetchPostProdSourceToFile:async(uri:string,file:string)=>{const data=h.media.get(uri);if(!data)throw Error("missing owned fixture");await writeFile(file,data);}}));
import {runMediaTool} from "./postProduction";
import {adoptCodeMotionEditedVideo} from "./codeMotionRevisionEditSettlement";
import {prepareCodeMotionVideoFrames} from "./codeMotionVideoFrames";
it("real FFmpeg 2.6s edit holds last frame to5s; formal consumer decodes150 frames and raw identity stays preserved",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"ink-edit-media-"));
 try{
  const raw=path.join(dir,"raw.mp4"),signal=AbortSignal.timeout(60000);
  await runMediaTool("ffmpeg",["-y","-f","lavfi","-i","testsrc2=size=640x360:rate=30","-t","2.6","-an","-c:v","libx264","-pix_fmt","yuv420p",raw],signal);
  const rawBytes=await readFile(raw),uri="gs://fixture/original.mp4";
  const asset=await adoptCodeMotionEditedVideo("7","child","cv_edit_media",uri,raw,2.6,5,dir);
  expect(asset.videoUri).not.toBe(uri);expect(await readFile(raw)).toEqual(rawBytes);
  const evidence=JSON.parse(h.files.get("code-motion/u7/production/child/video-sources/cv_edit_media.edit.json")!.toString());
  expect(evidence).toMatchObject({rawDuration:2.6,nominalDuration:5,method:"hold-last-frame",audio:"original-timeline-only"});expect(evidence.heldSeconds).toBeCloseTo(2.4);expect(evidence.rawSha256).not.toBe(evidence.normalizedSha256);
  const renderRoot=path.join(dir,"consumer");await mkdir(renderRoot);
  const frames=await prepareCodeMotionVideoFrames({version:1,assets:[asset],clips:[{assetId:asset.id,at:0,duration:5,sourceStartSec:0,fit:"cover"}]},{width:640,height:360,fps:30},renderRoot,signal,async()=>{});
  expect(frames.size).toBe(150);expect(await readFile(frames.get(149)!)).toEqual(await readFile(frames.get(140)!));
  await expect(adoptCodeMotionEditedVideo("7","child","short",uri,raw,0,5,dir)).rejects.toThrow("有效");
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
