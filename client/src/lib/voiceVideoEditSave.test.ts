import { beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
let make: (context: any) => (id:string, instruction:string)=>Promise<string>;
beforeAll(async()=>{
  const source=readFileSync("client/src/pages/OmniCanvas.tsx","utf8");
  const a=source.indexOf("  const handleVideoEditClip = useCallback(");
  const b=source.indexOf("  const advisorMediaSourceList",a);
  if(a<0 || b<0) throw Error("Actual callback not found");
  const code=await transform(`const {resolveUrlForCloudSync,isAdvisorMediaSourceUrl,resolveAdvisorMediaReferenceUrl,useCallback,factoryBusy,blocksRef,writerFocusEpisode,runFactory,canUseSeedance25,toast,getBlockEpisodeIndex,resolveClipLocalSegmentIndex,applyManhuaVideoEditInstruction,mergeManhuaMediaVersions,saveCanvasState,edges,setBlocks,setFactoryRunScope,window}=context;${source.slice(a,b)}`,{loader:"ts",target:"es2022"});
  make=new Function("context",code.code+";return handleVideoEditClip;") as typeof make;
});
function fixture(save=true){
  const original={id:"clip-e01-g01",episodeIndex:1,status:"done",outputUrl:"https://test/original.mp4",prompt:"original",outputUrls:[]};
  const c:any={resolveUrlForCloudSync:(v:string)=>v,isAdvisorMediaSourceUrl:(v:string)=>/^https?:|^\/api\/canvas-media\//.test(v),resolveAdvisorMediaReferenceUrl:vi.fn(async(v:string)=>v),useCallback:(f:any)=>f,factoryBusy:false,blocksRef:{current:[original]},writerFocusEpisode:1,runFactory:vi.fn(),canUseSeedance25:true,
    toast:{message:vi.fn(),error:vi.fn()},getBlockEpisodeIndex:()=>1,resolveClipLocalSegmentIndex:()=>1,applyManhuaVideoEditInstruction:()=>"edited",
    mergeManhuaMediaVersions:(_:any,v:any)=>v,saveCanvasState:vi.fn(()=>save),edges:[],setBlocks:vi.fn(),setFactoryRunScope:vi.fn(),window:{confirm:()=>true}};
  return {c,original,edit:()=>make(c)(original.id,"增加月夜冷光")};
}
it("真实视频编辑入口保存失败不提交、不改原片；成功后才进入预检",async()=>{
  const failed=fixture(false);expect(await failed.edit()).toContain("保存失败");expect(failed.c.runFactory).not.toHaveBeenCalled();expect(failed.c.setBlocks).not.toHaveBeenCalled();expect(failed.c.blocksRef.current[0]).toBe(failed.original);
  const ok=fixture();expect(await ok.edit()).toContain("预检");expect(ok.c.runFactory).toHaveBeenCalledTimes(1);expect(ok.c.blocksRef.current[0].outputUrl).toBe(ok.original.outputUrl);expect(ok.c.blocksRef.current[0].outputUrls).toContain(ok.original.outputUrl);expect(ok.c.saveCanvasState.mock.invocationCallOrder[0]).toBeLessThan(ok.c.runFactory.mock.invocationCallOrder[0]);
});
it("刷新后原视频任务运行中仍禁止重提",async()=>{
  const f=fixture();f.original.status="running";expect(await f.edit()).toContain("未结束");expect(f.c.saveCanvasState).not.toHaveBeenCalled();expect(f.c.runFactory).not.toHaveBeenCalled();
});

it("缓存原片先取鉴权读取地址，等待期间原片变化则不提交",async()=>{
 const f=fixture();f.original.outputUrl="blob:cached-video";f.c.resolveUrlForCloudSync=()=>"/api/canvas-media/generated/video.mp4";f.c.resolveAdvisorMediaReferenceUrl.mockResolvedValue("https://storage.googleapis.com/test/video.mp4?signed=1");
 expect(await f.edit()).toContain("预检");expect(f.c.blocksRef.current[0].refVideoUrl).toBe("https://storage.googleapis.com/test/video.mp4?signed=1");
 const changed=fixture();changed.c.resolveAdvisorMediaReferenceUrl.mockImplementation(async()=>{changed.c.blocksRef.current=[{...changed.original,prompt:"new"}];return "https://test/signed.mp4"});expect(await changed.edit()).toContain("原片已变化");expect(changed.c.runFactory).not.toHaveBeenCalled();
 const denied=fixture();denied.c.resolveAdvisorMediaReferenceUrl.mockRejectedValue(Error("denied"));expect(await denied.edit()).toContain("读取失败");expect(denied.c.runFactory).not.toHaveBeenCalled();expect(denied.c.saveCanvasState).not.toHaveBeenCalled();
});
