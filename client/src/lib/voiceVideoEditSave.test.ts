import { beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
let make: (context: any) => (id:string, instruction:string)=>string;
beforeAll(async()=>{
  const source=readFileSync("client/src/pages/OmniCanvas.tsx","utf8");
  const a=source.indexOf("  const handleVideoEditClip = useCallback(");
  const b=source.indexOf("  const advisorMediaSourceList",a);
  if(a<0 || b<0) throw Error("Actual callback not found");
  const code=await transform(`const {useCallback,factoryBusy,blocksRef,writerFocusEpisode,runFactory,canUseSeedance25,toast,getBlockEpisodeIndex,resolveClipLocalSegmentIndex,applyManhuaVideoEditInstruction,mergeManhuaMediaVersions,saveCanvasState,edges,setBlocks,setFactoryRunScope,window}=context;${source.slice(a,b)}`,{loader:"ts",target:"es2022"});
  make=new Function("context",code.code+";return handleVideoEditClip;") as typeof make;
});
function fixture(save=true){
  const original={id:"clip-e01-g01",episodeIndex:1,status:"done",outputUrl:"https://test/original.mp4",prompt:"original",outputUrls:[]};
  const c:any={useCallback:(f:any)=>f,factoryBusy:false,blocksRef:{current:[original]},writerFocusEpisode:1,runFactory:vi.fn(),canUseSeedance25:true,
    toast:{message:vi.fn(),error:vi.fn()},getBlockEpisodeIndex:()=>1,resolveClipLocalSegmentIndex:()=>1,applyManhuaVideoEditInstruction:()=>"edited",
    mergeManhuaMediaVersions:(_:any,v:any)=>v,saveCanvasState:vi.fn(()=>save),edges:[],setBlocks:vi.fn(),setFactoryRunScope:vi.fn(),window:{confirm:()=>true}};
  return {c,original,edit:()=>make(c)(original.id,"增加月夜冷光")};
}
it("真实视频编辑入口保存失败不提交、不改原片；成功后才进入预检",()=>{
  const failed=fixture(false);expect(failed.edit()).toContain("保存失败");expect(failed.c.runFactory).not.toHaveBeenCalled();expect(failed.c.setBlocks).not.toHaveBeenCalled();expect(failed.c.blocksRef.current[0]).toBe(failed.original);
  const ok=fixture();expect(ok.edit()).toContain("预检");expect(ok.c.runFactory).toHaveBeenCalledTimes(1);expect(ok.c.blocksRef.current[0].outputUrl).toBe(ok.original.outputUrl);expect(ok.c.blocksRef.current[0].outputUrls).toContain(ok.original.outputUrl);expect(ok.c.saveCanvasState.mock.invocationCallOrder[0]).toBeLessThan(ok.c.runFactory.mock.invocationCallOrder[0]);
});
it("刷新后原视频任务运行中仍禁止重提",()=>{
  const f=fixture();f.original.status="running";expect(f.edit()).toContain("未结束");expect(f.c.saveCanvasState).not.toHaveBeenCalled();expect(f.c.runFactory).not.toHaveBeenCalled();
});
