import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { renderManhuaVfx } from "./manhuaVfxRender";
import type { prepareManhuaVfxScene } from "./manhuaVfxSceneSource";
import type { ManhuaVfxJob } from "../../shared/manhuaVfx";

// 只注入失败回执；不生成图片、音视频、GLB，不调用云端或浏览器。
const request: ManhuaVfxJob = {action:"manhua_vfx",requestId:"12345678-1234-4234-8234-123456789abc",scopeKey:"test-project",params:{
  sourceKey:"test-source",videoUri:"gs://test/source.mp4",composition:{version:1,seed:3,effects:[{id:"market",kind:"prop_scene",startSec:0,durationSec:4,
    color:"#FFFFFF",scale:1,intensity:1,anchor:{space:"screen",position:[.5,.5]},
    prop:{impactSec:.25,spread:1.1,slowMotion:.18,gravity:.8,staggerSec:.1,holdStartSec:.8,holdDurationSec:1.2},
    world:{sceneJobId:`prv_${"b".repeat(48)}`,sceneScopeId:"12345678-1234-4234-8234-123456789abc",clipId:"clip",sourceStartSec:0,
      propKind:"fruit_stall_fracture",position:[0,0,1],yawDeg:0,size:1,render:{quality:"beauty",samples:16,exposure:0,keyEnergy:1000,fillRatio:.35,exportLayers:false},
      environment:{worldTaskId:`mw_${"a".repeat(24)}`,sceneRef:"market",sourceVersion:"gs://test/scene.png"}}}]}}};

it.each(["renderer-error","cancelled"])("正式场景%s保留导出前后原始回执，不进入影片合成或重试",async mode=>{
  const archived=new Map<string,Buffer>(), types=new Map<string,string>(), controller=new AbortController();
  const uploadResult=vi.fn(async()=>{throw new Error("不得生成结果");});
  const runStage=vi.fn(async(dir:string)=>{
    await writeFile(path.join(dir,"world-animation.frames.json"),JSON.stringify({testOnly:true}));
    await writeFile(path.join(dir,"stage-frames.raw.json"),JSON.stringify({complete:false,error:mode}));
    await writeFile(path.join(dir,"manifest.json"),JSON.stringify({complete:false,stageError:mode}));
    if(mode==="cancelled")controller.abort();
    throw new Error(mode);
  });
  const runMedia=vi.fn(async(command:string)=>{expect(command).toBe("ffprobe");return {stdout:JSON.stringify({streams:[{codec_type:"video",width:360,height:640,duration:"4",avg_frame_rate:"24/1"}]}),stderr:""};});
  await expect(renderManhuaVfx(request,"7",controller.signal,{
    fetch:async(_uri,target)=>{await writeFile(target,"TEST_ONLY_SOURCE_BYTES");return 22;},
    upload:async({objectName,buffer,signal,contentType})=>{types.set(path.basename(objectName),contentType);expect(signal?.aborted).toBe(false);archived.set(path.basename(objectName),Buffer.from(buffer));return {bucket:"test",objectName,gcsUri:`gs://test/${objectName}`};},
    prepareScene:async()=>({scenePath:"/test-only/scene.blend",sceneSha256:"b".repeat(64),sceneActors:[],receipt:{durationSec:4}} as unknown as Awaited<ReturnType<typeof prepareManhuaVfxScene>>),
    runBlender:async(_command,args)=>{const dir=args[args.length-1];await mkdir(dir,{recursive:true});await writeFile(path.join(dir,"world-animation.glb"),"TEST_ONLY_NON_MEDIA_BYTES");await writeFile(path.join(dir,"manifest.json"),JSON.stringify({complete:false,nativeStageExport:{complete:true}}));return "TEST_ONLY";},
    runStage,runMedia,uploadResult,
  })).rejects.toThrow("原片与任务记录已保留");
  expect(archived.get("world3d-animation.glb")?.toString()).toBe("TEST_ONLY_NON_MEDIA_BYTES");expect(types.get("world3d-animation.glb")).toBe("model/gltf-binary");
  expect(runStage).toHaveBeenCalledTimes(1);expect(runMedia).toHaveBeenCalledTimes(1);expect(uploadResult).not.toHaveBeenCalled();
  expect(JSON.parse(archived.get("world3d-manifest.json")!.toString())).toMatchObject({nativeStageExport:{complete:true}});
  expect(JSON.parse(archived.get("world3d-stage-manifest.json")!.toString())).toEqual({complete:false,stageError:mode});
  expect(JSON.parse(archived.get("world3d-stage-stage-frames.raw.json")!.toString())).toEqual({complete:false,error:mode});
  expect(JSON.parse(archived.get("failure.json")!.toString())).toMatchObject({error:mode});
});
