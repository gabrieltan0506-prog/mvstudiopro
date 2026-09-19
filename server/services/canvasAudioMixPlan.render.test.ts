import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyCanvasAudioMixPlan } from "../../shared/canvasAudioMixPlan";
import { createCanvasAudioCue } from "../../shared/canvasAudioStudio";
import { buildAudioTrimArgs, buildAudioTimelineArgs } from "./audioTimelineRender";
it("实际ffmpeg产物保留六秒，留白归零、对白窗降低至指定比例",()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'mvs-sound-proof-'));
 try {
  const source=path.join(dir,'source.wav'),output=path.join(dir,'mixed.wav');
  execFileSync('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6','-ac','2',source],{stdio:'ignore'});
  const cue={...createCanvasAudioCue('bgm','music'),startSec:0,endSec:6,approved:true,mix:{duckUnderDialogue:true,duckVolume:0.2,silenceWindows:[{startSec:4,endSec:5}]}};
  const dialogue={...createCanvasAudioCue('dialogue','d'),startSec:1,endSec:3,approved:true,selectedTakeId:'d1',takes:[{id:'d1',gcsUri:'gs://test-bucket/d.wav',durationSec:2,previewUrl:'',createdAt:'test',inputKey:'test'}]};
  const clips=applyCanvasAudioMixPlan(cue,{audioUri:'gs://test-bucket/source.wav',sourceStartSec:0,sourceEndSec:6,startSec:0,volume:1,fadeInSec:0,fadeOutSec:0},[cue,dialogue]);
  const paths=clips.map((clip,i)=>{const file=path.join(dir,`clip-${i}.wav`);const {startSec,...trimInput}=clip;execFileSync('ffmpeg',buildAudioTrimArgs(trimInput,source,file),{stdio:'ignore'});return file;});
  execFileSync('ffmpeg',buildAudioTimelineArgs({durationSec:6,clips},paths,output),{stdio:'ignore'});
  const pcm=execFileSync('ffmpeg',['-i',output,'-f','f32le','-ac','1','-ar','48000','pipe:1'],{maxBuffer:4_000_000,stdio:['ignore','pipe','ignore']});
  const rms=(start:number,end:number)=>{let sum=0;for(let i=Math.round(start*48000);i<Math.round(end*48000);i++)sum+=pcm.readFloatLE(i*4)**2;return Math.sqrt(sum/Math.round((end-start)*48000));};
  expect(pcm.length/4/48000).toBe(6);expect(rms(.3,.8)).toBeGreaterThan(.03);
  expect(rms(1.3,1.8)/rms(.3,.8)).toBeCloseTo(.2,2);expect(rms(4.2,4.8)).toBeLessThan(.00001);
  expect(rms(5.2,5.8)/rms(.3,.8)).toBeCloseTo(1,2);
  if(process.env.CLOSURE_EVIDENCE_DIR){mkdirSync(process.env.CLOSURE_EVIDENCE_DIR,{recursive:true});copyFileSync(output,path.join(process.env.CLOSURE_EVIDENCE_DIR,'sound-mix-window-proof.wav'));}
 } finally {rmSync(dir,{recursive:true,force:true});}
},30000);
