import { expect, it } from "vitest";
import { archiveVfxEnvironment, readVfxEnvironment, resolveVfxEnvironment, type VfxEnvironmentSource } from "./manhuaVfxEnvironment";
import { manhuaVfxEnvironmentOptions } from "../../shared/manhuaVfxEnvironment";
import type { ManhuaVfxJob } from "../../shared/manhuaVfx";
import type { ManhuaWorldTaskView } from "./manhuaWorldTask";

const binding={worldTaskId:`mw_${"a".repeat(24)}`,sceneRef:"market",sourceVersion:"gs://test-bucket/scene-v1.png"};
const source:VfxEnvironmentSource={taskId:binding.worldTaskId,sceneRef:binding.sceneRef,sourceVersion:binding.sourceVersion,status:"succeeded",
  assets:{spz500kGcsUri:`gs://test-bucket/manhua-world/u7/${binding.worldTaskId}/scene-500k.spz`,colliderGlbGcsUri:`gs://test-bucket/manhua-world/u7/${binding.worldTaskId}/collider.glb`,metricScaleFactor:1,groundPlaneOffset:1.6}};
const job:ManhuaVfxJob={action:"manhua_vfx",requestId:"12345678-1234-4234-8234-123456789abc",scopeKey:"project-a",params:{videoUri:"gs://test-bucket/post-prod/7/source.mp4",sourceKey:"source-v1",
  composition:{version:1,seed:3,effects:[{id:"market",kind:"prop_scene",startSec:0,durationSec:4,color:"#FFFFFF",scale:1,intensity:1,anchor:{space:"screen",position:[.5,.5]},
    prop:{impactSec:.25,spread:1.1,slowMotion:.18,gravity:.8,staggerSec:.1,holdStartSec:.8,holdDurationSec:1.2},
    world:{sceneJobId:`prv_${"b".repeat(48)}`,sceneScopeId:"12345678-1234-4234-8234-123456789abc",clipId:"clip",sourceStartSec:0,propKind:"fruit_stall_fracture",position:[0,0,1],yawDeg:0,size:1,
      render:{quality:"beauty",samples:16,exposure:0,keyEnergy:1000,fillRatio:.35,exportLayers:false},environment:binding}}]}}};

it("仅解析本人同图版本的完整3DGS归档，拒绝换图、别人的对象和缺失尺度",async()=>{
  const load=async(_id:string,user:number)=>user===7?source as ManhuaWorldTaskView:null;
  const deps={load,bucket:()=>"test-bucket"};
  expect(await resolveVfxEnvironment("7",binding,deps)).toEqual(source);
  await expect(resolveVfxEnvironment("8",binding,deps)).rejects.toThrow("不存在");
  await expect(resolveVfxEnvironment("7",{...binding,sourceVersion:"changed"},deps)).rejects.toThrow("版本");
  for(const changed of [{...source,assets:{...source.assets,metricScaleFactor:undefined}},
    {...source,assets:{...source.assets,spz500kGcsUri:source.assets.spz500kGcsUri.replace('/u7/','/u8/')}}, {...source,status:"running"}])
    await expect(resolveVfxEnvironment("7",binding,{...deps,load:async()=>changed as ManhuaWorldTaskView})).rejects.toThrow();
});
it("入队快照绑定完整不可变请求，数据库键重排可恢复，换作品/机位参数/账号拒绝",async()=>{
  let saved:Buffer|undefined,key="";
  await archiveVfxEnvironment("7",job,"market",{resolve:async()=>source,write:async(k,b)=>{key=k;saved=b;}});
  const deps={read:async(k:string)=>{expect(k).toBe(key);return Buffer.from(saved!);},bucket:()=>"test-bucket"};
  expect(await readVfxEnvironment("7",job,"market",deps)).toEqual(source);
  const reordered={params:job.params,scopeKey:job.scopeKey,requestId:job.requestId,action:job.action};
  expect(await readVfxEnvironment("7",reordered,"market",deps)).toEqual(source);
  await expect(readVfxEnvironment("7",{...job,scopeKey:"another-project"},"market",deps)).rejects.toThrow("快照");
  const changed=structuredClone(job);changed.params.composition.effects[0].world!.position[0]=1;
  await expect(readVfxEnvironment("7",changed,"market",deps)).rejects.toThrow("快照");
  const bad=JSON.parse(saved!.toString());bad.source.assets.metricScaleFactor=2;saved=Buffer.from(JSON.stringify(bad));
  await expect(readVfxEnvironment("7",job,"market",deps)).rejects.toThrow("快照");
});
it("快照存储失败不宣称已封存，不改用可变网站记录",async()=>{
  await expect(archiveVfxEnvironment("7",job,"market",{resolve:async()=>source,write:async()=>{throw Error("TEST_ONLY storage unavailable");}})).rejects.toThrow("storage unavailable");
});
it("作品入口只列已确认的当前场景，旧模型或缺碰撞面不会混入",()=>{
  const ref={id:"market",labelZh:"果摊街道",role:"scene",reviewStatus:"accepted",url:"https://example.test/scene.png",gcsUri:binding.sourceVersion,
    world3d:{taskId:binding.worldTaskId,status:"succeeded" as const,sourceVersion:binding.sourceVersion,model:"marble-1.1" as const,assets:source.assets,updatedAt:1}};
  expect(manhuaVfxEnvironmentOptions([ref])).toHaveLength(1);
  for(const row of [{...ref,role:"character"},{...ref,reviewStatus:"pending"},{...ref,gcsUri:"gs://test-bucket/new.png"},
    {...ref,world3d:{...ref.world3d,assets:{...source.assets,colliderGlbGcsUri:undefined}}}])expect(manhuaVfxEnvironmentOptions([row])).toHaveLength(0);
});
