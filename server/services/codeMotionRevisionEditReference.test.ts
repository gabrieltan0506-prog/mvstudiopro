import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const h=vi.hoisted(()=>({media:new Map<string,Buffer>(),commands:[] as string[][]}));
vi.mock("./postProduction",()=>({runMediaTool:async(tool:string,args:string[])=>{h.commands.push([tool,...args]);return {stdout:execFileSync(tool,args,{encoding:"utf8"}),stderr:""};},fetchPostProdSourceToFile:async(uri:string,file:string)=>{await writeFile(file,h.media.get(uri)!);}}));
vi.mock("./gcs",()=>({getGcsBucketName:()=>"fixture",uploadBufferToGcsIfAbsent:async(v:any)=>h.media.set(`gs://fixture/${v.objectName}`,v.buffer)}));
vi.mock("./canvasMediaOwnership",()=>({registerCanvasMediaOwner:async()=>"created"}));
import {prepareCodeMotionEditReference} from "./codeMotionRevisionEditReference";
it("formal reference preflight preserves1s source and pads to5s, trims31s to5s and restores without rendering again",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"ink-edit-input-"));const files=new Map<string,Buffer>();const storage={read:async(n:string)=>files.has(n)?{body:files.get(n)!,generation:"1"}:null,write:async(n:string,b:Buffer)=>{files.set(n,b);return"1";},list:async()=>[]};
 try{for(const duration of [1,31]){
  const file=path.join(dir,`raw${duration}.mp4`);execFileSync("ffmpeg",["-loglevel","error","-y","-f","lavfi","-i","testsrc2=size=128x72:rate=30","-t",String(duration),"-an","-c:v","libx264",file]);
  const bytes=await readFile(file),uri=`gs://fixture/raw${duration}.mp4`;h.media.set(uri,bytes);const raw={duration,sha256:createHash("sha256").update(bytes).digest("hex"),width:128,height:72};
  const ref=await prepareCodeMotionEditReference("7","project",uri,raw,5,"paid",storage);
  expect(ref).toMatchObject({duration:5,rawDuration:duration,rawSha256:raw.sha256,strategy:duration===1?"hold-last-frame":"trim-to-selected-scene"});expect(h.media.get(uri)).toEqual(bytes);expect(ref?.sha256).not.toBe(raw.sha256);
  const count=h.commands.length;expect(await prepareCodeMotionEditReference("7","project",uri,raw,5,"paid",storage)).toEqual(ref);expect(h.commands.length).toBe(count);
  expect(await prepareCodeMotionEditReference("7","project",uri,{...raw,duration:5},5,"paid",storage)).toBeUndefined();
 }
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
