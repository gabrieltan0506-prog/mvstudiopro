import { afterEach, expect, it, vi } from "vitest";
import { runCanvasBlock } from "./canvasRunBlock";
import { defaultCanvasBlock } from "./canvasTypes";
afterEach(()=>vi.restoreAllMocks());
it("手动文字分镜执行器携带分镜用途，失败不转其它模型",async()=>{
 const optimizeCopy=vi.fn().mockRejectedValue(new Error("503 selected model"));
 const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("禁止网络"));
 const block={...defaultCanvasBlock("video_reverse",0,0),id:"reverse-e01-test",prompt:"本集已确认正文：甲进门，乙抬头。"};
 await expect(runCanvasBlock({optimizeCopy},block)).rejects.toThrow("503 selected model");
 expect(optimizeCopy).toHaveBeenCalledTimes(1);expect(optimizeCopy.mock.calls[0][0]).toMatchObject({storyboardCandidate:true});expect(fetch).not.toHaveBeenCalled();
});

for (const stage of ["story", "bible", "beats"] as const) {
 it(`${stage}沿编剧所选模型，明确失败不降到通用Kimi或Gemini`, async()=>{
  const optimizeCopy=vi.fn().mockRejectedValue(new Error("selected model failed"));
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("禁止旁路"));
  const block={...defaultCanvasBlock("text",0,0),id:`${stage}-e03-test`,episodeIndex:3,prompt:"本集剧情：甲跨进门槛，乙看见他袖边的血痕。"};
  await expect(runCanvasBlock({optimizeCopy},block)).rejects.toThrow("selected model failed");
  expect(optimizeCopy).toHaveBeenCalledTimes(1);
  expect(optimizeCopy.mock.calls[0][0]).toMatchObject({storyboardEpisodeIndex:3,factoryTextStage:stage==="bible"?"assets":stage});
  expect(network).not.toHaveBeenCalled();
 });
}
