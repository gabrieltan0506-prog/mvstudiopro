import {it,expect,vi} from 'vitest';
import {prepareStageAnimationAudio} from './manhuaStageAnimationAudio';
import {defaultArtMotionSpec} from '../../shared/artMotion';
import {createManhuaPrevisStudio} from '../../shared/manhuaPrevis';
it('动画时序音轨在下载前执行真实归属校验，拒绝混合旧单音轨',async()=>{
 const audio={version:1 as const,startSec:0,durationSec:2,sourceKey:'bgm',dialogueCount:0,bgmCount:1,clips:[{audioUri:'gs://test/bgm.wav',sourceStartSec:0,sourceEndSec:2,startSec:0,volume:.5,fadeInSec:.1,fadeOutSec:.2}]};
 const spec={...defaultArtMotionSpec(),duration:2,audioTimeline:audio};
 const source={requestId:crypto.randomUUID(),scopeId:crypto.randomUUID(),clipId:'test',spec:createManhuaPrevisStudio(2).spec};
 const fetch=vi.fn(),run=vi.fn(),validate=vi.fn(async()=>{throw Error('素材未授权')});
 await expect(prepareStageAnimationAudio(spec,source,'7','/unused',new AbortController().signal,{fetch,run,validate})).rejects.toThrow('素材未授权');
 expect(validate).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
 await expect(prepareStageAnimationAudio({...spec,audioUri:'gs://test/other.wav'},source,'7','/unused',new AbortController().signal,{fetch,run,validate})).rejects.toThrow('不一致');
});
it('场景动画复用真实混音实现，保留多个裁片、源偏移和淡变参数',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os');
 const root=await mkdtemp(tmpdir()+'/stage-bgm-test-');
 const clips=[{audioUri:'gs://test/bgm.wav',sourceStartSec:2,sourceEndSec:3,startSec:0,volume:.4,fadeInSec:.1,fadeOutSec:.2},{audioUri:'gs://test/bgm.wav',sourceStartSec:5,sourceEndSec:6,startSec:1,volume:.2,fadeInSec:0,fadeOutSec:.1}];
 const spec={...defaultArtMotionSpec(),duration:2,audioTimeline:{version:1 as const,startSec:0,durationSec:2,sourceKey:'bgm',dialogueCount:0,bgmCount:1,clips}};
 const source={requestId:crypto.randomUUID(),scopeId:crypto.randomUUID(),clipId:'test',spec:createManhuaPrevisStudio(2).spec};
 const run=vi.fn(async(command:string,args:string[])=>command==='ffprobe'?JSON.stringify({streams:[{codec_type:'audio',duration:args.at(-1)?.includes('source-')?10:args.at(-1)?.includes('timeline')?2:1}]}):'');
 const fetch=vi.fn(async()=>1);
 try{
  const output=await prepareStageAnimationAudio(spec,source,'7',root,new AbortController().signal,{run,fetch,validate:async()=>{}});
  expect(output).toBe(root+'/audio/timeline.wav');expect(fetch).toHaveBeenCalledOnce();
  const commands=run.mock.calls.filter(([c])=>c==='ffmpeg').map(([,args])=>args.join(' '));
  expect(commands).toHaveLength(3);expect(commands[0]).toContain('volume=0.4');expect(commands[0]).toContain('afade');expect(commands[1]).toContain('volume=0.2');expect(commands[2]).toContain('adelay=48000S');expect(commands[2]).toContain('amix=inputs=2');
 }finally{await rm(root,{recursive:true,force:true});}
});
