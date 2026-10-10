import { expect, it } from "vitest";
import { transform } from "esbuild";
import { validateVfxStageTimeline } from "./manhuaVfxStageRender";
import { buildVfxStagePage } from "./manhuaVfxStagePage";

function fixture(){
  const meta={width:360,height:640,fps:24,durationSec:2/24};
  const camera={position:[0,0,0],quaternionXYZW:[0,0,0,1],vfovRad:Math.PI/4,clipStart:.1,clipEnd:100};
  const timeline={version:1,complete:true,...meta,coordinateSystem:"stage-z-up-meters",objectIds:["actor","fragment"],fragmentIds:["fragment"],
    frames:[1,2].map(frame=>({frame,timeSec:(frame-1)/24,active:true,camera:structuredClone(camera),visibleObjectIds:["actor","fragment"],fragmentOpacity:{fragment:1}}))};
  delete (timeline as Partial<typeof meta>).durationSec;
  const proof={nativeStageExport:{complete:true,glbSha256:"a".repeat(64),framesSha256:"b".repeat(64)},frames:timeline.frames.map(row=>({frame:row.frame,timeSec:row.timeSec,
    effects:[{active:true,cameraMatrixWorld:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],cameraClip:[.1,100],cameraVfovRad:camera.vfovRad}]}))};
  return{meta,timeline,proof};
}
it("3DGS消费与原场景逐帧位置、方向、视角、可见性、透明度闭合",()=>{
  const {meta,timeline,proof}=fixture();expect(validateVfxStageTimeline(timeline,proof,meta).frames).toHaveLength(2);
  const edits=[
    (x:typeof timeline)=>{x.frames[1].camera.position[0]=1;},
    (x:typeof timeline)=>{x.frames[0].camera.vfovRad=.8;},
    (x:typeof timeline)=>{x.frames[0].camera.quaternionXYZW=[0,0,1,0];},
    (x:typeof timeline)=>{x.frames[0].camera.clipEnd=101;},
    (x:typeof timeline)=>{x.frames[1].frame=1;},
    (x:typeof timeline)=>{x.frames[0].visibleObjectIds.push("other-person");},
    (x:typeof timeline)=>{x.frames[0].fragmentOpacity.fragment=2;},
    (x:typeof timeline)=>{x.fragmentIds.push("fragment");},
  ];
  for(const edit of edits){const bad=structuredClone(timeline);edit(bad);expect(()=>validateVfxStageTimeline(bad,proof,meta)).toThrow();}
});
it("非活动帧不能夹带人物，源帧缺失不能当成透明空白成功",()=>{
  const {meta,timeline,proof}=fixture();timeline.frames[0].active=false;proof.frames[0].effects[0].active=false;
  expect(()=>validateVfxStageTimeline(timeline,proof,meta)).toThrow("可见性");
  timeline.frames[0].visibleObjectIds=[];expect(()=>validateVfxStageTimeline(timeline,proof,meta)).not.toThrow();
  proof.frames.pop();expect(()=>validateVfxStageTimeline(timeline,proof,meta)).toThrow("帧数");
});
it("固定渲染页面可被JS解析器编译，不启动浏览器或媒体任务",async()=>{
  const html=buildVfxStagePage({origin:"http://127.0.0.1:12345",width:360,height:640,fps:24,
    transform:{scale:1,quaternionXYZW:[0,0,0,1],translationStage:[0,0,0]},light:{samples:16,exposure:0,keyEnergy:1000,fillRatio:.35}});
  const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];expect(code).toBeTruthy();
  await expect(transform(code!,{loader:"js",target:"es2022"})).resolves.toHaveProperty("code");
});
