import { expect, it } from "vitest";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { buildAdvisorWorkflowEvidence } from "./manhuaAdvisorWorkflowEvidence";
import { defaultCanvasBlock } from "./canvasTypes";
import { buildManhuaAdvisorProject } from "./manhuaAdvisorProject";
import { buildManhuaCreativeAdvisorLlmMessages } from "../../../server/services/platformSkillQa";

it("第一集已采用带骨版本与第二集几何马身份从生产者到实际LLM输入保持区别且无媒体URL", () => {
  const first = createManhuaPrevisStudio(2);
  first.spec.actors[0].assetRef = "horse-ref";
  first.spec.actors[0].nameZh = "墨屠";
  first.spec.actors[0].shape = "horse";
  first.spec.actors[0].riggedModel = { sourceJobId: "m3d_horse_rig", rigKind: "quadruped", forwardAxis: "+X", targetHeight: 1.7 };
  first.selectedJobId = "prv_saved_first";
  first.history.push({ jobId: "prv_saved_first", requestId: "11111111-1111-4111-8111-111111111111", url: "https://private.invalid/preview", gcsUri: "gs://private/preview", durationSec: 2, createdAt: "2026-10-07", spec: structuredClone(first.spec) });
  const second = createManhuaPrevisStudio(2);
  second.spec.actors[0].nameZh = "墨屠";second.spec.actors[0].shape = "horse";
  const blocks = [{ ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", episodeIndex: 1, previsStudio: first }, { ...defaultCanvasBlock("video", 0, 0), id: "clip-e02-g01", episodeIndex: 2, previsStudio: second }];
  const evidence = buildAdvisorWorkflowEvidence([], blocks);
  expect(evidence).toContain('"episodeIndex":1');expect(evidence).toContain('"episodeIndex":2');expect(evidence).toContain('"selected":true');expect(evidence).toContain("m3d_horse_rig");expect(evidence).toContain("不能推断模型无骨");expect(evidence).not.toContain("private");
  const context = manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "墨菁传", episodeIndex: 2, episodeTitle: "", stage: "assets", videoModel: "未选择", writerConfirmed: true, episodeBody: "取血", assetSummary: "", shotSummary: "", blockers: [], workflowEvidenceZh: evidence });
  const messages = buildManhuaCreativeAdvisorLlmMessages({ question: "查第一集墨屠版本", rawQuestion: "查第一集墨屠版本", context });
  expect(JSON.stringify(messages)).toContain("m3d_horse_rig");expect(JSON.stringify(messages)).toContain("prv_saved_first");
});

it("零配置统计不会冒称已保存GLB没有骨架或其他集未完成", () => {
  const result = buildManhuaAdvisorProject({ pack: null, bible: null, episodeIndex: 2, phase: "assets", videoModel: "", writerConfirmed: false, refs: [], blocks: [], pipeline3d: "模型就绪 9/18 · 已绑骨 0/18 · 白模参考 0 段" });
  expect(result.issues.find(x => x.id === "rig")?.text).toContain("不证明模型文件无骨");
  expect(result.issues.find(x => x.id === "rig")?.text).not.toContain("这些角色只能站着");
});

it("同一工程全部已加载集数全文进入顾问契约，不只发送当前集且不节选正文", () => {
 const pack={seriesTitle:"墨菁传",episodes:[{index:1,title:"前集",body:"腿伤未愈".repeat(1500),endHook:"河滩"},{index:2,title:"今集",body:"寻找先生",endHook:"药铺"}]} as any;
 const result=buildManhuaAdvisorProject({pack,bible:null,episodeIndex:2,phase:"final",videoModel:"",writerConfirmed:true,refs:[],blocks:[]});
 const context=manhuaCreativeAdvisorContextSchema.parse(result.context);
 expect(context.continuityEpisodes?.[0].body).toBe(pack.episodes[0].body);
 expect(context.continuityEpisodes?.map(ep=>ep.episodeIndex)).toEqual([1,2]);
 const messages=buildManhuaCreativeAdvisorLlmMessages({question:"检查跨集矛盾",rawQuestion:"检查跨集矛盾",context});
 expect(JSON.stringify(messages)).toContain(pack.episodes[0].body);
 expect(JSON.stringify(messages)).toContain("不是成片观察");
});

it("跨集任务证据不截断尾部，特效只读取匹配当前来源的保存记录", () => {
 const refs=Array.from({length:200},(_,i)=>({id:"asset-"+i,labelZh:"角色".repeat(60),role:"character",model3d:{taskId:"model-"+i,status:"succeeded"}})) as any;
 const state={version:1,scopeKey:"current",requests:{},adoptedRequestId:undefined} as any;
 const evidence=buildAdvisorWorkflowEvidence(refs,[],{scopeKey:"current",episodeIndex:2,state});
 expect(evidence.length).toBeGreaterThan(16000);
 const context=manhuaCreativeAdvisorContextSchema.parse({seriesTitle:"墨菁传",episodeIndex:2,episodeTitle:"",stage:"final",videoModel:"未选择",writerConfirmed:true,episodeBody:"",assetSummary:"",shotSummary:"",blockers:[],workflowEvidenceZh:evidence});
 expect(context.workflowEvidenceZh).toContain("model-199");
 expect(context.workflowEvidenceZh).toContain('"tool":"vfx"');
 expect(buildAdvisorWorkflowEvidence([],[],{scopeKey:"other",episodeIndex:2,state})).not.toContain('"tool":"vfx"');
});
