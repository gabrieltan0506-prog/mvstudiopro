import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { buildManhuaAdvisorProject } from "./manhuaAdvisorProject";
import { buildManhuaCreativeAdvisorLlmMessages } from "../../../server/services/platformSkillQa";
import { buildAdvisorPrevisSummary } from "./manhuaAdvisorPrevis";
import type { CanvasBlock } from "./canvasTypes";
function clip() {
 const studio=createManhuaPrevisStudio();studio.spec.actors[0].nameZh="伏兵甲";
 studio.history=[];studio.referenceHistory=[{url:"https://private.invalid/private.mp4",gcsUri:"gs://private/reference",updatedAt:"now"}];
 return {id:"clip-e01-g01",kind:"video",previsStudio:studio} as CanvasBlock;
}
describe("白模规格到顾问真实消息链",()=>{
 it("当前规格从project→严格schema→服务端LLM消息保持，媒体位置不进入上下文",()=>{
  const block=clip();const project=buildManhuaAdvisorProject({pack:null,bible:null,episodeIndex:1,phase:"storyboard",videoModel:"",writerConfirmed:false,refs:[],blocks:[block]});
  const context=manhuaCreativeAdvisorContextSchema.parse(project.context);
  expect(context.previsSummary).toContain("伏兵甲");expect(context.previsSummary).toContain("未读取或播放实际视频");
  const messages=buildManhuaCreativeAdvisorLlmMessages({question:"检查白模规格",context});
  expect(messages[1].content).toContain(context.previsSummary!);expect(messages[1].content).not.toContain("private.invalid");expect(messages[1].content).not.toContain("gs://");
 });
 it("过滤归档版本，空规格不编造，容量和媒体URL由共享schema拒绝",()=>{
  expect(buildAdvisorPrevisSummary([{...clip(),archivedFromPreviousScript:true}])).toContain("没有可读取");
  const base=buildManhuaAdvisorProject({pack:null,bible:null,episodeIndex:1,phase:"outline",videoModel:"",writerConfirmed:false,refs:[],blocks:[]}).context;
  expect(manhuaCreativeAdvisorContextSchema.safeParse({...base,previsSummary:"字".repeat(6001)}).success).toBe(false);
  expect(manhuaCreativeAdvisorContextSchema.safeParse({...base,previsSummary:"https://private.invalid/clip"}).success).toBe(false);
 });
});
