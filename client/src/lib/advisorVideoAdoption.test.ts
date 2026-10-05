import {beforeAll,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
let make:(context:any)=>(id:string,url:string,taskId:string)=>void;
beforeAll(async()=>{
 const source=readFileSync("client/src/pages/OmniCanvas.tsx","utf8");
 const a=source.indexOf("          applyVideo: (blockId,url,taskId) => {");const b=source.indexOf("          editVideo: async plan",a);
 if(a<0||b<0)throw Error("Actual adoption callback not found");
 const fn=source.slice(a,b).trim().replace(/^applyVideo: /,"").replace(/,$/,"");
 const code=await transform(`const {factoryBusy,writerBusy,cloudConflict,blocksRef,resolveUrlForCloudSync,backupVoiceProduction,mergeManhuaMediaVersions,saveCanvasState,edges,setBlocks}=context; const apply=${fn};`,{loader:"ts",target:"es2022"});
 make=new Function("context",code.code+";return apply;") as typeof make;
});
function fixture(saved=true){
 const original={id:"clip-e01-g01",kind:"video",status:"done",videoTaskId:"t1",videoTaskStatus:"succeeded",outputUrl:"https://test/old.mp4",outputUrls:["https://test/old.mp4","https://test/new.mp4"],lastFrameUrl:"old.jpg"};
 const c:any={factoryBusy:false,writerBusy:false,cloudConflict:false,blocksRef:{current:[original]},resolveUrlForCloudSync:(s:string)=>s,backupVoiceProduction:vi.fn(),mergeManhuaMediaVersions:(a:any,b:any)=>Array.from(new Set([...a,...b])),saveCanvasState:vi.fn(()=>saved),edges:[],setBlocks:vi.fn()};
 return {c,original,apply:make(c)};
}
it("视频采用先备份后保存，失败保留原片；任务变化及外来候选拒绝",()=>{
 const failed=fixture(false);expect(()=>failed.apply(failed.original.id,"https://test/new.mp4","t1")).toThrow("保存失败");expect(failed.c.blocksRef.current[0]).toBe(failed.original);expect(failed.c.setBlocks).not.toHaveBeenCalled();
 const ok=fixture();ok.apply(ok.original.id,"https://test/new.mp4","t1");expect(ok.c.blocksRef.current[0].outputUrl).toBe("https://test/new.mp4");expect(ok.c.blocksRef.current[0].outputUrls).toContain("https://test/old.mp4");expect(ok.c.backupVoiceProduction.mock.invocationCallOrder[0]).toBeLessThan(ok.c.saveCanvasState.mock.invocationCallOrder[0]);
 const stale=fixture();expect(()=>stale.apply(stale.original.id,"https://test/new.mp4","t2")).toThrow("任务已变化");expect(()=>stale.apply(stale.original.id,"https://foreign/video.mp4","t1")).toThrow("不属于");expect(stale.c.backupVoiceProduction).not.toHaveBeenCalled();
 const busy=fixture();busy.c.writerBusy=true;expect(()=>make(busy.c)(busy.original.id,"https://test/new.mp4","t1")).toThrow("未采用");
});

it("视频采用保留私有与本机原片地址，不静默丢掉历史版本",()=>{
 const f=fixture();f.original.outputUrl="/api/canvas-media/uploads/u1/original.mp4";f.original.outputUrls=[f.original.outputUrl,"local-media:v1/previous","https://test/new.mp4"];
 f.apply(f.original.id,"https://test/new.mp4","t1");
 expect(f.c.blocksRef.current[0].outputUrls).toContain(f.original.outputUrl);
 expect(f.c.blocksRef.current[0].outputUrls).toContain("local-media:v1/previous");
});
