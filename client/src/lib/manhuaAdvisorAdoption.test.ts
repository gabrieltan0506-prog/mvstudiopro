import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { prepareAdvisorRewriteAdoption, persistAdvisorRewriteAdoption, advisorRewriteHasActiveWork } from "./manhuaAdvisorAdoption";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { buildManhuaWriterSession, serializeManhuaWriterSession, loadManhuaWriterSessionFromStorage, MANHUA_WRITER_SESSION_LS_KEY } from "@shared/manhuaWriterSession";
import { MANHUA_BOARD_MOTION_OVERLAY_FORMAT } from "@shared/manhuaDirectorBoardOverlay";
import { type ManhuaDirectorBoardOverlayBySegment } from "./manhuaDirectorBoardStore";
import { diffManhuaWriterPacks } from "@shared/manhuaWriterPackDiff";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";

const pack:ManhuaWriterPack={seriesTitle:"船战",logline:"寻信物",charactersMd:"甲、乙",propsMd:"剑",locationsMd:"船",rawMarkdown:"旧正文".repeat(40),episodeCount:3,episodes:[1,2,3].map(index=>({index,title:`第${index}集`,body:`原稿${index}`,endHook:"待续"}))};
const candidate={episodeIndex:2,originalBody:"原稿2",rewrittenBody:"她踏上甲板，看见来人手中熟悉的信物。她稳住脚步询问来意，来人却指向船舱，船舱里传来清晰的脚步声。",changes:["前置身份悬念"]};
function fixture(){
 const block=(id:string,episodeIndex:number,url?:string)=>({...defaultCanvasBlock(id.startsWith("clip")||id.startsWith("final")?"video":"image",0,0),id,episodeIndex,outputUrl:url,outputUrls:url?[url]:[]});
 const blocks=[block("clip-e01-g01",1,"https://test.invalid/1.mp4"),block("keyart-e02-g01",2,"https://test.invalid/2.png"),block("clip-e02-g01",2,"https://test.invalid/2.mp4"),block("clip-e02-g02",2),block("final-e03",3,"https://test.invalid/3.mp4"),block("charsheet-shared",1,"https://test.invalid/actor.png"),block("free-image",2,"https://test.invalid/free.png")];
 const edges=[{fromId:"keyart-e02-g01",toId:"clip-e02-g01"},{fromId:"clip-e02-g02",toId:"final-e03"}];
 return {candidate,writerPack:structuredClone(pack),projectBible:null,blocks,edges,overlays:{},busy:false};
}
function storage(failAt=0){const values=new Map<string,string>([[MANHUA_WRITER_SESSION_LS_KEY,serializeManhuaWriterSession(buildManhuaWriterSession({writerPack:pack,writerConfirmed:true,directorUnlocked:true,workflowPhase:"final",topic:"保留的题材"}))],["mv-freeform-canvas-v1","original-canvas"],["mv-manhua-director-board-overlay-v1","{}"]]);const writes:string[]=[];let n=0;return {values,writes,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{writes.push(k);if(++n===failAt)throw Error("配额不足");values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
function persist(plan:ReturnType<typeof prepareAdvisorRewriteAdoption>,f:ReturnType<typeof fixture>,s:ReturnType<typeof storage>){return persistAdvisorRewriteAdoption({plan,original:{writerPack:f.writerPack,projectBible:f.projectBible,blocks:f.blocks,edges:f.edges,overlays:f.overlays},userId:"1",backupId:"test-id",createdAt:"2026-09-20T05:40:00.000Z"},s);}

describe("顾问采用真实归档与持久化",()=>{
 it("只改目标集，当前及后续产物归档，前集/共享资产/自由节点不改，空节点及边清理",()=>{
  const f=fixture(),before=structuredClone(f),plan=prepareAdvisorRewriteAdoption(f);
  expect(plan.writerPack.episodes[0]).toEqual(pack.episodes[0]);expect(plan.writerPack.episodes[2]).toEqual(pack.episodes[2]);expect(plan.writerPack.episodes[1].body).toBe(candidate.rewrittenBody);
  expect(plan.writerPack.rawMarkdown).toContain(candidate.rewrittenBody);expect(plan.writerPack.rawMarkdown).not.toContain("旧正文");
  for(const id of ["clip-e01-g01","charsheet-shared","free-image"])expect(plan.canvas.blocks.find(b=>b.id===id)).toEqual(f.blocks.find(b=>b.id===id));
  for(const id of ["keyart-e02-g01","clip-e02-g01","final-e03-archived"])expect(plan.canvas.blocks.find(b=>b.id===id)?.archivedFromPreviousScript).toBe(true);
  expect(plan.canvas.blocks.find(b=>b.id==="clip-e02-g02")).toBeUndefined();expect(plan.canvas.edges).toEqual([{fromId:"keyart-e02-g01",toId:"clip-e02-g01"}]);
  expect(f).toEqual(before);expect(plan).toMatchObject({writerConfirmed:false,directorUnlocked:false,workflowPhase:"outline",focusEpisode:2});
 });
 it("只使当前及后续导演板待审，较早集手调坐标保留",()=>{
  const overlay=(episodeIndex:number)=>({format:MANHUA_BOARD_MOTION_OVERLAY_FORMAT,episodeIndex,segmentIndex:1,shotIndex:1,imageSpace:"normalized" as const,sourceRevision:"rev1",baseAspectRatio:"16:9" as const,actorRoutes:[],cameraPath:null,axis:{subjectAnchors:[{entityId:"甲",at:{x:.4,y:.6}}]},landingPoints:[],userAdjusted:true,needsReview:false});
  const overlays:ManhuaDirectorBoardOverlayBySegment={1:{1:overlay(1)},2:{1:overlay(2)},3:{1:overlay(3)}};
  const plan=prepareAdvisorRewriteAdoption({...fixture(),overlays});expect(plan.overlays[1]).toBe(overlays[1]);expect(plan.overlays[2][1].needsReview).toBe(true);expect(plan.overlays[3][1].needsReview).toBe(true);expect(overlays[2][1].needsReview).toBe(false);
 });
 it("真实归档器保留仅存超分、历史版本、后期及母轨引用的节点",()=>{
  const patches:Partial<CanvasBlock>[]=[{upscaledVideoUrl:"https://test.invalid/upscaled.mp4"},{manhuaFinalVersions:[{origin:"assemble",url:"",gcsUri:"gs://test/history.mp4",createdAt:1}]},{manhuaFinalPostProd:{action:"burn_subtitle",jobId:"old",sourceUrl:"",status:"succeeded",updatedAt:1,resultGcsUri:"gs://test/burned.mp4"}},{manhuaSegmentRefs:{master:{url:"https://test.invalid/master.wav",updatedAt:"now"}}},{manhuaSegmentRefs:{registered:{url:"https://test.invalid/registered.mp4",updatedAt:"now"}}}];
  for(const patch of patches){const f=fixture();f.blocks[3]={...f.blocks[3],...patch};const plan=prepareAdvisorRewriteAdoption(f);expect(plan.canvas.blocks.find(b=>b.id===f.blocks[3].id)).toMatchObject({...patch,archivedFromPreviousScript:true});}
 });
 it("旧稿备份是第一笔写入；真实会话读取恢复新稿与失效确认态，原文/付费引用保留",()=>{
  const f=fixture(),s=storage(),plan=prepareAdvisorRewriteAdoption(f);const key=persist(plan,f,s);
  expect(s.writes[0]).toBe(key);const backup=JSON.parse(s.getItem(key)!);expect(backup.writerPack).toEqual(pack);expect(backup.canvas.blocks).toEqual(f.blocks);
  const restored=loadManhuaWriterSessionFromStorage(s);expect(restored?.writerPack?.episodes[1].body).toBe(candidate.rewrittenBody);expect(restored).toMatchObject({writerConfirmed:false,directorUnlocked:false,workflowPhase:"outline",topic:"保留的题材"});
  expect(JSON.parse(s.getItem("mv-freeform-canvas-v1")!).blocks.find((b:CanvasBlock)=>b.id==="clip-e02-g01").outputUrl).toBe("https://test.invalid/2.mp4");
 });
 it("备份失败或中途持久化失败均拒绝采用，恢复原来的存档",()=>{
  for(const failAt of [1,2,3,4]){const f=fixture(),s=storage(failAt),before=new Map(s.values),plan=prepareAdvisorRewriteAdoption(f);expect(()=>persist(plan,f,s)).toThrow(/未采用/);for(const[k,v]of Array.from(before))expect(s.getItem(k)).toBe(v);}
 });
 it("原稿冲突与所有已知未决任务拒绝，终态任务不误挡",()=>{
  expect(()=>prepareAdvisorRewriteAdoption({...fixture(),candidate:{...candidate,originalBody:"过期"}})).toThrow("原稿已改变");expect(()=>prepareAdvisorRewriteAdoption({...fixture(),busy:true})).toThrow("任务");
  const active:Partial<CanvasBlock>[]=[{videoTaskId:"unknown"},{upscaleTaskId:"unknown"},{status:"running"},{videoTaskStatus:"running"},{videoTaskStatus:"timed_out_pending_reconcile"},{videoIntentStatus:"unverified"},{upscaleStatus:"queued"},{audioStudio:{schemaVersion:1,cues:[],musicJobIds:[],pendingOperations:[{id:"pending",kind:"bgm",inputKey:"input"}]}},{manhuaFinalPostProd:{action:"burn_subtitle",jobId:"pending",sourceUrl:"old",status:"running",updatedAt:1}}];
  for(const patch of active){const f=fixture();f.blocks[0]={...f.blocks[0],...patch};expect(()=>prepareAdvisorRewriteAdoption(f)).toThrow("任务");}
  expect(advisorRewriteHasActiveWork([{...fixture().blocks[0],videoTaskStatus:"succeeded",upscaleStatus:"failed",videoIntentStatus:"settled"}])).toBe(false);
 });
});

// 提取并执行真实宿主JSX回调：生产helper/归档/会话序列化保留，只有React setter作为观察边界。
const source=readFileSync(new URL("../pages/OmniCanvas.tsx",import.meta.url),"utf8");
const tree=ts.createSourceFile("OmniCanvas.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback="";
function visit(n:ts.Node){if(ts.isJsxAttribute(n)&&n.name.getText(tree)==="onApplyRewrite"&&n.initializer&&ts.isJsxExpression(n.initializer))callback=n.initializer.expression!.getText(tree);ts.forEachChild(n,visit);}visit(tree);
const callbackJs=ts.transpileModule(`(${callback})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
it("生产OmniCanvas回调只有持久化成功后才改状态，失败不清理当前工程",()=>{
 for(const failAt of [0,1,3]){
  const f=fixture(),s=storage(failAt),setters:Record<string,ReturnType<typeof vi.fn>>={};
  for(const name of ["setBlocks","setEdges","bumpManhuaOutboundEpoch","setDirectorBoardMotionOverlayBySegment","setWriterPackDiff","setWriterPack","setWriterConfirmed","setDirectorUnlocked","setWorkflowPhase","setWriterFocusEpisode","setWriterConfirmBlockers","setAdvisorOpen"])setters[name]=vi.fn(()=>{expect(s.writes.length).toBeGreaterThanOrEqual(4);});
  const fn=runInNewContext(callbackJs,{...setters,...f,writerBusy:false,factoryBusy:false,assembleBusy:false,burnSubtitleBusy:false,segmentRefBusyId:null,assetStandardizeBusyId:null,asset3dBusyIds:[],sceneWorldBusyIds:[],directorBoardMotionOverlayBySegment:{},user:{id:1},crypto:{randomUUID:()=>"test-id"},toast:{error:vi.fn()},materializedBoardIdsRef:{current:{clear:vi.fn()}},prepareAdvisorRewriteAdoption,persistAdvisorRewriteAdoption:(input:Parameters<typeof persistAdvisorRewriteAdoption>[0])=>persistAdvisorRewriteAdoption(input,s),diffManhuaWriterPacks});
  expect(fn(candidate)).toBe(failAt===0);
  if(failAt){for(const setter of Object.values(setters))expect(setter).not.toHaveBeenCalled();}
  else{expect(setters.setWriterConfirmed).toHaveBeenCalledWith(false);expect(setters.setDirectorUnlocked).toHaveBeenCalledWith(false);expect(setters.setWriterPack.mock.calls[0][0].episodes[1].body).toBe(candidate.rewrittenBody);}
 }
});

it("真实采用备份指导再次确认：前集活动成果保留，新剧或改动过的整稿不复用范围", async()=>{
 const {advisorReconfirmationFromEpisode}=await import("./manhuaAdvisorBackups");
 const {stripManhuaFactoryCanvasArtifacts}=await import("./canvasDramaStudio");
 const f=fixture(),s=storage(),plan=prepareAdvisorRewriteAdoption(f);persist(plan,f,s);
 const readable={get length(){return s.values.size},key:(i:number)=>Array.from(s.values.keys())[i]??null,getItem:s.getItem};
 const fromEpisode=advisorReconfirmationFromEpisode(readable,"1",plan.writerPack);
 expect(fromEpisode).toBe(2);
 const confirmed=stripManhuaFactoryCanvasArtifacts(plan.canvas.blocks,plan.canvas.edges,{fromEpisode});
 expect(confirmed.blocks.find(b=>b.id==="clip-e01-g01")).toEqual(f.blocks[0]);
 expect(confirmed.blocks.find(b=>b.id==="clip-e02-g01")?.archivedFromPreviousScript).toBe(true);
 expect(advisorReconfirmationFromEpisode(readable,"2",plan.writerPack)).toBeUndefined();
 expect(advisorReconfirmationFromEpisode(readable,"1",{...plan.writerPack,charactersMd:"另一批人物"})).toBeUndefined();
 expect(advisorReconfirmationFromEpisode(readable,"1",plan.writerPack,"other-project")).toBeUndefined();
 const confirmSource=source.slice(source.indexOf("const confirmWriterToDirector ="),source.indexOf("const confirmWriterToDirector =")+13000);
 expect(confirmSource).toContain("advisorReconfirmationFromEpisode(localStorage, String(user.id), writerPack, projectBible?.confirmedAt)");
 expect(confirmSource).toContain("stripManhuaFactoryCanvasArtifacts(blocks, edges, { fromEpisode })");
 expect(confirmSource).toContain("resolveManhuaEpisodeSpawnContinuity(writerPack.episodes, fromEpisode ?? writerFocusEpisode)");
});
