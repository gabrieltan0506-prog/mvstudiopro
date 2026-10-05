import { afterEach, expect, it, vi } from "vitest";
import { generateVoiceStoryboardGraph } from "./creativeVoiceStoryboard";
import { spawnManhuaDramaStudio, resolveShotsForEpisodeKeyarts } from "./canvasDramaStudio";
import * as runner from "./canvasRunBlock";
afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const a=spawnManhuaDramaStudio({topic:"玄璃推门",episodeIndex:1});
 const b=spawnManhuaDramaStudio({topic:"保留第二集",episodeIndex:2});
 return {blocks:[...a.blocks.map(x=>x.id.startsWith("beats-")?{...x,outputText:"1. 旧镜头\n2. 旧结尾",status:"done" as const}:x),...b.blocks],edges:[...a.edges,...b.edges]};
}
it("候选只请求本集文字模型，旧节拍不遮盖新分镜，另一集与原图数据不变",async()=>{
 const graph=fixture(),before=JSON.stringify(graph);
 const spy=vi.spyOn(runner,"runCanvasBlock").mockResolvedValue({outputText:"1. 玄璃推门\n2. 玄璃抬眼\n3. 玄璃转身"});
 const result=await generateVoiceStoryboardGraph({graph,episode:1,body:"玄璃推门抬眼转身。",question:"完整分成三镜",deps:{optimizeCopy:async()=>""},ensureOptions:{},signal:new AbortController().signal});
 expect(spy).toHaveBeenCalledTimes(1);expect(spy.mock.calls[0]![1].id).toMatch(/^reverse-e01/);
 expect(resolveShotsForEpisodeKeyarts(result.blocks,1)).toHaveLength(3);
 expect(JSON.stringify(graph)).toBe(before);
 for(const b of graph.blocks.filter(b=>b.episodeIndex===2))expect(result.blocks.find(x=>x.id===b.id)).toEqual(b);
},20000);
it("空输出即使旧节拍有效也不能成为候选，供应商错误不自动重试",async()=>{
 const graph=fixture();const spy=vi.spyOn(runner,"runCanvasBlock").mockResolvedValue({outputText:""});
 await expect(generateVoiceStoryboardGraph({graph,episode:1,body:"正文",question:"分镜",deps:{optimizeCopy:async()=>""},ensureOptions:{},signal:new AbortController().signal})).rejects.toThrow();
 expect(spy).toHaveBeenCalledTimes(1);
 spy.mockClear().mockRejectedValue(new Error("503 transient"));
 await expect(generateVoiceStoryboardGraph({graph,episode:1,body:"正文",question:"分镜",deps:{optimizeCopy:async()=>""},ensureOptions:{},signal:new AbortController().signal})).rejects.toThrow("503");
 expect(spy).toHaveBeenCalledTimes(1);
},20000);
it("真实文字执行器失败时不进入客户端重试或备用供应商",async()=>{
 const graph=fixture();const optimizeCopy=vi.fn().mockRejectedValue(new Error("503 provider unavailable"));
 const fetchSpy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("禁止测试访问网络"));
 await expect(generateVoiceStoryboardGraph({graph,episode:1,body:"正文",question:"完整分镜",deps:{optimizeCopy,singleTextAttempt:true},ensureOptions:{},signal:new AbortController().signal})).rejects.toThrow("503");
 expect(optimizeCopy).toHaveBeenCalledTimes(1);expect(fetchSpy).not.toHaveBeenCalled();
},20000);
