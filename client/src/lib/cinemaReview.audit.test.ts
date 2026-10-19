import { ensureManhuaFragmentClips, expandManhuaShotKeyartsAfterReverse, spawnManhuaDramaStudio } from "./canvasDramaStudio";
import { assertDigitalHumanCinemaApplied, compileDigitalHumanCinema } from "@shared/digitalHumanCinema";
import { readFileSync } from "node:fs";
import { mergeManhuaDerivedClipPrompt } from "@shared/manhuaClipUserSupplement";
import { expect, it, vi, afterEach } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { applyDigitalHumanCinema, digitalHumanCinemaSchema } from "@shared/digitalHumanCinema";
import { previewCanvasBlockOutbound } from "./canvasRunBlock";
import { canvasVideoTaskInputFingerprint, captureCanvasVideoTaskResumeSnapshot, resolveCanvasVideoTaskResume } from "./canvasVideoTaskResume";
import { MANHUA_SEEDANCE_DIRECTOR_PROMPT_MAX_CHARS } from "@shared/jsonDirectorMiddleware";
afterEach(()=>vi.unstubAllGlobals());
const cinema=digitalHumanCinemaSchema.parse({movement:"缓推",palette:"暖金",customLights:[{direction:"左侧",color:"#ffffff",brightness:60,softness:80}]});
const make=(prompt:string)=>({...defaultCanvasBlock("video",0,0),id:"cinema-audit",videoModel:"seedance-2.5" as const,refImageUrl:"https://test.invalid/person.png",cinema,prompt:applyDigitalHumanCinema(prompt,cinema)});
it("审查01：既有路径配方不得覆盖已采用的Cinema内容",async()=>{
 const network=vi.fn(()=>{throw Error("禁止真实网络")});vi.stubGlobal("fetch",network);
 const result=await previewCanvasBlockOutbound({userRole:"admin",optimizeCopy:async()=>""},{...make("目标时长：5秒。人物看书。"),pathCameraRecipeId:"path_03_evidence_push"});
 console.log("AUDIT_RECIPE",JSON.stringify({hasCinema:String(result.body.prompt).includes("【Cinema导演设置】"),hasCustomLight:String(result.body.prompt).includes("亮度60%"),networkCalls:network.mock.calls.length}));
 expect(result.body.prompt).toContain("Cinema导演设置");
 expect(result.body.prompt).toContain("亮度60%");
 expect(result.body.prompt).toContain("人物看书");
});
it("审查02：长正文后的已采用Cinema不得静默截断",async()=>{
 const network=vi.fn(()=>{throw Error("禁止真实网络")});vi.stubGlobal("fetch",network);
 const block=make("目标时长：5秒。"+"人物看书。".repeat(Math.ceil(MANHUA_SEEDANCE_DIRECTOR_PROMPT_MAX_CHARS/5)));
 await expect(previewCanvasBlockOutbound({userRole:"admin",optimizeCopy:async()=>""},block)).rejects.toThrow("本次未提交");
 expect(network).not.toHaveBeenCalled();
});
it("审查03：没有使用Cinema的旧MV在途任务升级后仍应成为当前结果",()=>{
 const block={...defaultCanvasBlock("video",0,0),id:"mvshot-old",status:"running",videoTaskId:"old-task",videoTaskEngine:"seedance",videoTaskStatus:"running",musicMvShot:{planRequestId:"00000000-0000-4000-8000-000000000001",audioId:"old-audio",shotId:"shot1",startSec:0,endSec:5,referenceImages:[],kind:"generated"}} as CanvasBlock;
 const old=JSON.parse(canvasVideoTaskInputFingerprint(block));delete old.cinema;
 block.musicMvShot!.activeTask={taskId:"old-task",inputFingerprint:JSON.stringify(old)};
 const snapshot=captureCanvasVideoTaskResumeSnapshot(block)!;
 const result=resolveCanvasVideoTaskResume(block,snapshot,{transportOk:true,status:"succeeded",videoUrl:"https://test.invalid/result.mp4"},"2026-10-19T14:40:00Z");
 console.log("AUDIT_LEGACY",JSON.stringify({outcome:result?.outcome,status:result?.patch.status,selectedNewOutput:result?.selectedNewOutput,outputUrl:result?.patch.outputUrl,history:result?.patch.outputUrls}));
 expect(result?.selectedNewOutput).toBe(true);expect(result?.patch.outputUrl).toBe("https://test.invalid/result.mp4");
});

it("审查04：工厂普通重生成必须保留已采用Cinema区块",()=>{
 const before=applyDigitalHumanCinema("旧系统分镜正文",cinema);
 const after=mergeManhuaDerivedClipPrompt("按新资产编译的分镜正文",before);
 console.log("AUDIT_FACTORY",JSON.stringify({beforeHasCinema:before.includes("【Cinema导演设置】"),afterHasCinema:after.includes("【Cinema导演设置】"),after}));
 expect(after.includes("【Cinema导演设置】")).toBe(true);
});

it("审查05：参考素材异步准备的输入快照必须识别Cinema改稿",()=>{
 const source=readFileSync("client/src/components/canvas/FreeformCanvas.tsx","utf8");
 const start=source.indexOf("const inputFingerprint = (item: CanvasBlock) => ")+"const inputFingerprint = (item: CanvasBlock) => ".length;
 const end=source.indexOf(";",start);
 const fingerprint=new Function("item",`return ${source.slice(start,end)}`) as (block:CanvasBlock)=>string;
 const before=make("目标时长：5秒。人物看书。");
 const after={...before,cinema:{...cinema,movement:"拉远"}};
 console.log("AUDIT_ASYNC",JSON.stringify({sameSnapshot:fingerprint(before)===fingerprint(after),promptUnchanged:before.prompt===after.prompt,cinemaChanged:before.cinema.movement!==after.cinema.movement}));
 expect(fingerprint(after)).not.toBe(fingerprint(before));
});

it("工厂真实重编译保留已采用Cinema、用户补充及旧成片，待采用改稿仍拒绝", async () => {
 const spawned=spawnManhuaDramaStudio({topic:"人物在书房看书",episodeIndex:1,videoModel:"seedance-2.5"});
 const reverse=spawned.blocks.find(b=>b.id.startsWith("reverse-"))!;
 const source=spawned.blocks.map(b=>b.id===reverse.id?{...b,status:"done" as const,outputText:"1. 人物看书\n2. 人物抬眼\n3. 人物合书"}:b);
 const expanded=expandManhuaShotKeyartsAfterReverse(source,spawned.edges,reverse.id,{videoModel:"seedance-2.5"});
 const ready=expanded.blocks.map(b=>b.id.startsWith("keyart-")?{...b,status:"done" as const,outputUrl:`https://example.test/${b.id}.png`}:b);
 const initial=ensureManhuaFragmentClips(ready,expanded.edges,1,{videoModel:"seedance-2.5"});
 const clip=initial.blocks.find(b=>b.id.startsWith("clip-")&&!b.archivedFromPreviousScript)!;
 expect(clip).toBeDefined();
 const applied={...clip,cinema,prompt:applyDigitalHumanCinema(clip.prompt,cinema),outputUrl:"https://example.test/accepted.mp4"};
 const next=ensureManhuaFragmentClips(initial.blocks.map(b=>b.id===clip.id?applied:b),initial.edges,1,{videoModel:"seedance-2.5"});
 const actual=next.blocks.find(b=>b.id===clip.id)!;
 expect(actual.prompt).toContain(compileDigitalHumanCinema(cinema));
 expect(actual.outputUrl).toBe(applied.outputUrl);
 expect(()=>assertDigitalHumanCinemaApplied({cinema:actual.cinema,direction:actual.prompt},"reference")).not.toThrow();
 const pending={...actual,cinema:{...cinema,movement:"拉远"}};
 const again=ensureManhuaFragmentClips(next.blocks.map(b=>b.id===clip.id?pending:b),next.edges,1,{videoModel:"seedance-2.5"});
 const changed=again.blocks.find(b=>b.id===clip.id)!;
 expect(changed.prompt).toContain("运镜：缓推");
 expect(()=>assertDigitalHumanCinemaApplied({cinema:changed.cinema,direction:changed.prompt},"reference")).toThrow("采用");
});
it("工厂重复编译不叠导演区块，也不丢人工补充",()=>{
 const original=applyDigitalHumanCinema("旧系统\n\n【用户补充】\n保留动作意图",cinema);
 const first=mergeManhuaDerivedClipPrompt("新系统",original);
 const second=mergeManhuaDerivedClipPrompt("再次更新系统",first);
 expect(second).toContain("再次更新系统");
 expect(second).toContain("保留动作意图");
 expect(second.match(/【Cinema导演设置】/g)).toHaveLength(1);
 expect(second).toContain(compileDigitalHumanCinema(cinema));
});

it.each(["seedance-2.5", "wan-3.0", "minimax-hailuo-3"] as const)("Cinema完整参数穿过%s真实出站格式层",async(videoModel)=>{
 const network=vi.fn(()=>{throw Error("禁止真实网络");});vi.stubGlobal("fetch",network);
 const settings=digitalHumanCinemaSchema.parse({genre:"自动",movement:"缓推",camera:"自动",customPalette:["#112233","#aabbcc"],customLights:[{direction:"左侧",color:"#ffffff",brightness:100,softness:0},{direction:"背面",color:"#abcdef",brightness:0,softness:100}]});
 const block={...make("目标时长：5秒。人物看书。"),cinema:settings,videoModel,prompt:applyDigitalHumanCinema("目标时长：5秒。人物看书。",settings)};
 const result=await previewCanvasBlockOutbound({userRole:"admin",optimizeCopy:async()=>""},block);
 expect(result.body.prompt).toContain("#112233");expect(result.body.prompt).toContain("柔和度100%");expect(result.body.prompt).toContain("人物看书");
 expect(network).not.toHaveBeenCalled();
});
