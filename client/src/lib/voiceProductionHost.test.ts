import { beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
import { evaluateManhuaAsset3dEligibility } from "@shared/manhuaAsset3d";
import { evaluateManhuaWorld3dEligibility } from "@shared/manhuaWorld3d";
import { advisorWorldSourceRevision } from "@shared/manhuaAdvisorWorld";
let make:(c:any)=>(action:any, signal:AbortSignal)=>Promise<string>;
beforeAll(async()=>{
 const s=readFileSync("client/src/pages/OmniCanvas.tsx","utf8"), marker="onVoiceProduction={", a=s.indexOf(marker)+marker.length, b=s.indexOf("\n        onVoiceNavigate=",a);
 if(a<marker.length || b<0)throw Error("Actual host handler missing");
 const expr=s.slice(a,b).trim().slice(0,-1);
 const keys="writerBusy,factoryBusy,cloudConflict,latestCustomAssetRefs,projectBible,writerFocusEpisode,blocksRef,isManhuaClipBlockId,getBlockEpisodeIndex,setWorkflowPhase,setManhuaUiMode,setImmersiveWorkspaceView,window,CANVAS_IMAGE_CREDITS_PER_SHOT,CANVAS_IMAGE_CREDITS_BATCH,backupVoiceProduction,confirmAssetsAndPrepareImages,canUseManhua3d,evaluateManhuaAsset3dEligibility,generateManhua3dAsset,evaluateManhuaWorld3dEligibility,retrySceneWorld,advisorWorldSourceRevision,setAdvisorPrevisClipId,setAdvisor3dContext,setAdvisorFocusSection,setWriterFocusEpisode,setAdvisorSelection,resolveClipLocalSegmentIndex,setAdvisorPrevisRequest";
 const built=await transform(`const {${keys}}=context;const handler=${expr};`,{loader:"ts",target:"es2022"});make=new Function("context",built.code+";return handler") as typeof make;
});
function fixture(){
 const c:any={writerBusy:false,factoryBusy:false,cloudConflict:false,canUseManhua3d:true,latestCustomAssetRefs:{current:[]},projectBible:{assetCanon:{characters:[{id:"hero",nameZh:"沈昀"}],locations:[],props:[]}},writerFocusEpisode:1,blocksRef:{current:[]},isManhuaClipBlockId:(id:string)=>id.startsWith("clip-"),getBlockEpisodeIndex:(b:any)=>b.episodeIndex,
 window:{confirm:vi.fn(()=>true)},CANVAS_IMAGE_CREDITS_PER_SHOT:54,CANVAS_IMAGE_CREDITS_BATCH:49,backupVoiceProduction:vi.fn(),confirmAssetsAndPrepareImages:vi.fn(),generateManhua3dAsset:vi.fn(),retrySceneWorld:vi.fn(),evaluateManhuaAsset3dEligibility,evaluateManhuaWorld3dEligibility,advisorWorldSourceRevision,resolveClipLocalSegmentIndex:()=>1};
 for(const k of ["setWorkflowPhase","setManhuaUiMode","setImmersiveWorkspaceView","setAdvisorPrevisClipId","setAdvisor3dContext","setAdvisorFocusSection","setWriterFocusEpisode","setAdvisorSelection","setAdvisorPrevisRequest"])c[k]=vi.fn();
 return {c,run:(action:any)=>make(c)(action,new AbortController().signal)};
}
it("实际画布语音缺图进入资产页；2D取消不提交，无回执不冒称完成",async()=>{
 const {c,run}=fixture();await expect(run({action:"model3d",assetId:"hero"})).rejects.toThrow("缺少可用2D");expect(c.setWorkflowPhase).toHaveBeenCalledWith("assets");expect(c.generateManhua3dAsset).not.toHaveBeenCalled();
 c.window.confirm.mockReturnValue(false);expect(await run({action:"image2d",anchorId:"hero"})).toContain("取消");expect(c.confirmAssetsAndPrepareImages).not.toHaveBeenCalled();
 c.window.confirm.mockReturnValue(true);expect(await run({action:"image2d",anchorId:"hero"})).toContain("未取得");expect(c.backupVoiceProduction).toHaveBeenCalledTimes(1);
 c.confirmAssetsAndPrepareImages.mockImplementation(async(o:any)=>o.onReceipt({planned:2,completed:1,assets:[]}));expect(JSON.parse(await run({action:"image2d",anchorId:"hero"}))).toMatchObject({planned:2,completed:1});
});
it("实际画布语音人物模型透传原任务回执，运行中的3DGS不重试",async()=>{
 const {c,run}=fixture();c.latestCustomAssetRefs.current=[{id:"hero",role:"character",reviewStatus:"accepted",url:"https://test/hero.png"},{id:"scene",role:"scene",reviewStatus:"accepted",url:"https://test/scene.png",world3d:{taskId:"old-world",sourceVersion:"https://test/scene.png",status:"running"}}];
 c.generateManhua3dAsset.mockImplementation(async(_id:string,receipt:any)=>receipt({taskId:"original-model",status:"running"}));expect(JSON.parse(await run({action:"model3d",assetId:"hero"}))).toMatchObject({taskId:"original-model",status:"running"});
 await expect(run({action:"retryWorld",assetId:"scene"})).rejects.toThrow("明确失败");expect(c.retrySceneWorld).not.toHaveBeenCalled();
 c.latestCustomAssetRefs.current[1].world3d.status="failed";c.retrySceneWorld.mockImplementation(async(_id:string,receipt:any)=>receipt({taskId:"new-world",status:"queued"}));expect(JSON.parse(await run({action:"retryWorld",assetId:"scene"}))).toMatchObject({previousTaskId:"old-world",taskId:"new-world",status:"queued"});
});
it("实际画布语音白模跳转保留目标集段，取消的会话不触发备份或导航",async()=>{
 const {c,run}=fixture();c.blocksRef.current=[{id:"clip-e02-g01",episodeIndex:2,status:"done",prompt:"second episode"}];expect(await run({action:"previs",clipId:"clip-e02-g01"})).toContain("未提交渲染");expect(c.setAdvisorPrevisRequest).toHaveBeenCalledWith(expect.objectContaining({clipId:"clip-e02-g01",episode:2,segment:1}));
 const ac=new AbortController();ac.abort();await expect(make(c)({action:"previs",clipId:"clip-e02-g01"},ac.signal)).rejects.toThrow("语音已结束");expect(c.backupVoiceProduction).toHaveBeenCalledTimes(1);
});
