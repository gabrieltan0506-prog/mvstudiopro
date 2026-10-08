import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisStudioSchema } from "./manhuaPrevis";
import { applyAdvisorPrevisPatch, advisorPrevisPatchSchema, advisorPrevisSpecJson, advisorPrevisTargetSchema, adoptAdvisorPrevisTrial, applyAdvisorPrevisCandidate, makeAdvisorPrevisTarget, parseAdvisorPrevisPatch, prepareAdvisorPrevisTrial, validateAdvisorPrevisReceipt, type AdvisorPrevisTrial } from "./manhuaAdvisorPrevisEdit";

function setup() {
  const studio = createManhuaPrevisStudio(5);
  studio.spec.actors[0].assetRef = "character-existing";
  const candidate = { target: makeAdvisorPrevisTarget("clip-1", studio), patch: advisorPrevisPatchSchema.parse({ kind: "previs_edit_v1", summaryZh: "镜头缓推至近景", unsupportedZh: [], cameras: studio.spec.cameras.map(c => ({ ...c, endLens: 60 })) }) };
  return { studio, candidate };
}
function receipt(trial: AdvisorPrevisTrial) {
  return { jobId: "previs-test-job", status: "succeeded", params: trial.request, output: { requestId: trial.request.requestId, clipId: "clip-1", gcsUri: "gs://test/preview.mp4", url: "/api/manhua-previs-media/test/preview", durationSec: 5 } };
}
describe("顾问独立试看与确认写回边界", () => {
  it("动画导出经顾问确认后保留到存储恢复，缺失或串任务回执不覆盖旧稿", () => {
    const { studio, candidate } = setup();
    studio.spec.exportAnimation = true;
    candidate.target = makeAdvisorPrevisTarget("clip-1", studio);
    const before = JSON.stringify(studio);
    const trial = prepareAdvisorPrevisTrial("clip-1", studio, candidate);
    const jobId = `prv_${"a".repeat(48)}`;
    const animation = { glbUrl: `/api/manhua-previs-media/${jobId}/animation`, framesUrl: `/api/manhua-previs-media/${jobId}/animation-frames`, sha256: "b".repeat(64), framesSha256: "c".repeat(64) };
    const good = { ...receipt(trial), jobId, output: { ...receipt(trial).output, animation } };
    expect(trial.request.spec.exportAnimation).toBe(true);
    const restored = manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(adoptAdvisorPrevisTrial("clip-1", studio, trial, good))));
    const take = restored.history.find(h => h.requestId === trial.request.requestId)!;
    expect(take.animation).toEqual(animation);
    expect(take.sourceScopeId).toBe(trial.request.scopeId);
    expect(take.sourceScopeId).not.toBe(studio.scopeId);
    expect(restored.selectedJobId).toBe(take.jobId);
    expect(take.spec).toEqual(restored.spec);
    for (const invalid of [undefined, { ...animation, framesSha256: "" }, { ...animation, glbUrl: animation.glbUrl.replace(jobId, `prv_${"d".repeat(48)}`) }]) {
      expect(() => adoptAdvisorPrevisTrial("clip-1", studio, trial, { ...good, output: { ...good.output, animation: invalid } })).toThrow("动画回执");
    }
    expect(JSON.stringify(studio)).toBe(before);
  });
  it("给模型的上下文排除素材身份，非法模型字段和地址不能进入候选", () => {
    const { studio, candidate } = setup();
    expect(advisorPrevisSpecJson(studio.spec)).not.toContain("character-existing");
    expect(advisorPrevisTargetSchema.safeParse({ ...candidate.target, specJson: JSON.stringify(studio.spec) }).success).toBe(false);
    expect(advisorPrevisPatchSchema.safeParse({ ...candidate.patch, actors: [{ id: studio.spec.actors[0].id, assetRef: "other" }] }).success).toBe(false);
    expect(advisorPrevisPatchSchema.safeParse({ ...candidate.patch, summaryZh: "https://unexpected.test" }).success).toBe(false);
  });
  it("解析答复中的候选并在独立scope准备试看，原工作流完全不变", () => {
    const { studio, candidate } = setup(); const before = JSON.stringify(studio);
    expect(parseAdvisorPrevisPatch("```json\n" + JSON.stringify(candidate.patch) + "\n```")).toEqual(candidate.patch);
    const trial = prepareAdvisorPrevisTrial("clip-1", studio, candidate);
    expect(trial.request.scopeId).not.toBe(studio.scopeId);
    expect(trial.request.spec.cameras[0].endLens).toBe(60);
    expect(trial.request.spec.actors[0].assetRef).toBe("character-existing");
    expect(JSON.stringify(studio)).toBe(before);
    validateAdvisorPrevisReceipt(trial.request, receipt(trial));
    expect(JSON.stringify(studio)).toBe(before);
  });
  it("只在显式应用时保存试看、原配置与确认编号，原参考保持", () => {
    const { studio, candidate } = setup();
    studio.referenceHistory = [{ url: "https://test.invalid/reference.mp4", updatedAt: "2026-09-29T00:00:00Z" }];
    const trial = prepareAdvisorPrevisTrial("clip-1", studio, candidate);
    const adopted = adoptAdvisorPrevisTrial("clip-1", studio, trial, receipt(trial));
    expect(manhuaPrevisStudioSchema.safeParse(adopted).success).toBe(true);
    expect(adopted.referenceHistory).toEqual(studio.referenceHistory);
    expect(adopted.specHistory?.at(-1)?.spec).toEqual(studio.spec);
    expect(adopted.specHistory?.at(-1)?.reasonZh).toContain(trial.request.requestId);
    expect(adopted.history[0].requestId).toBe(trial.request.requestId);
    expect(studio.history).toHaveLength(0);
  });
  it("原场景在聊天后变化、片段切换或任务在途时拒绝覆盖", () => {
    const { studio, candidate } = setup();
    expect(() => applyAdvisorPrevisCandidate("clip-other", studio, candidate)).toThrow("其他片段");
    expect(() => applyAdvisorPrevisCandidate("clip-1", { ...studio, scopeId: crypto.randomUUID() }, candidate)).toThrow("其他片段");
    const trial = prepareAdvisorPrevisTrial("clip-1", studio, candidate);
    expect(() => applyAdvisorPrevisCandidate("clip-1", { ...studio, pending: trial.request }, candidate)).toThrow("仍在处理");
    studio.spec.cameras[0].lens = 50;
    expect(() => adoptAdvisorPrevisTrial("clip-1", studio, trial, receipt(trial))).toThrow("配置已变化");
  });
  it("失败、伪配对、时长不符及不同请求回执均不能应用", () => {
    const { studio, candidate } = setup(); const trial = prepareAdvisorPrevisTrial("clip-1", studio, candidate); const good = receipt(trial);
    for (const bad of [
      { ...good, status: "failed" },
      { ...good, output: { ...good.output, requestId: crypto.randomUUID() } },
      { ...good, output: { ...good.output, clipId: "other" } },
      { ...good, output: { ...good.output, durationSec: 4 } },
      { ...good, params: { ...trial.request, scopeId: crypto.randomUUID() } },
    ]) expect(() => adoptAdvisorPrevisTrial("clip-1", studio, trial, bad)).toThrow();
    expect(studio.history).toHaveLength(0);
  });
  it("不支持、未知角色、重复角色和无实质变化都不能渲染", () => {
    const { studio, candidate } = setup();
    for (const patch of [
      { ...candidate.patch, unsupportedZh: ["暂不支持表情"] },
      { ...candidate.patch, actors: [{ id: "missing", facingDeg: 90 }] },
      { ...candidate.patch, actors: [{ id: studio.spec.actors[0].id }, { id: studio.spec.actors[0].id }] },
      { ...candidate.patch, cameras: studio.spec.cameras },
    ]) expect(() => prepareAdvisorPrevisTrial("clip-1", studio, { ...candidate, patch })).toThrow();
  });
  it("片尾空窗或超范围镜头被实际渲染契约拒绝", () => {
    const { studio, candidate } = setup();
    for (const cameras of [[{ ...studio.spec.cameras[0], endSec: 4 }], [{ ...studio.spec.cameras[0], lens: 100 }]])
      expect(() => prepareAdvisorPrevisTrial("clip-1", studio, { ...candidate, patch: { ...candidate.patch, cameras } })).toThrow();
  });
});

it("1007场景特效候选保留身份与时长，支持显式清空且拒绝未知演员",()=>{
 const studio=createManhuaPrevisStudio(5);const spec=studio.spec;
 const patch=advisorPrevisPatchSchema.parse({kind:"previs_edit_v1",summaryZh:"仅加灵体材质",unsupportedZh:[],sceneEffects:[{id:"fx",kind:"hologram",actorId:spec.actors[0]!.id,color:"#66CCFF",intensity:1}]});
 const next=applyAdvisorPrevisPatch(spec,patch);
 expect(next.actors).toEqual(spec.actors);expect(next.durationSec).toBe(spec.durationSec);expect(next.cameras).toEqual(spec.cameras);
 expect(next.sceneEffects).toHaveLength(1);
 expect(applyAdvisorPrevisPatch(next,{...patch,sceneEffects:[]}).sceneEffects).toEqual([]);
 expect(()=>applyAdvisorPrevisPatch(spec,{...patch,sceneEffects:[{...patch.sceneEffects![0],actorId:"foreign-actor"}]})).toThrow();
});


it("剧情道具和四足倒地经过顾问候选、应用、序列化恢复仍保留", () => {
  const studio = createManhuaPrevisStudio(5);
  studio.spec.actors[0].shape = "horse";
  studio.spec.actors[0].actions = [];
  studio.spec.actors[0].end = [...studio.spec.actors[0].start];
  const actorId = studio.spec.actors[0].id;
  const patch = advisorPrevisPatchSchema.parse({ kind:"previs_edit_v1",summaryZh:"马侧卧保持，袖光位置可见",unsupportedZh:[],
    actors:[{id:actorId,quadrupedFall:{mode:"hold",side:"left"}}],
    storyProps:[{id:"glow",kind:"sleeve_glow",keyframes:[0,5].map(timeSec=>({timeSec,anchor:{type:"bone",actorId,bone:"body"}}))}] });
  const next = applyAdvisorPrevisCandidate("clip",studio,{target:makeAdvisorPrevisTarget("clip",studio),patch});
  const restored = manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(next)));
  expect(restored.spec.actors[0].quadrupedFall).toEqual({mode:"hold",side:"left"});
  expect(restored.spec.storyProps).toHaveLength(1);
  expect(restored.specHistory?.at(-1)?.spec).toEqual(studio.spec);
  expect(applyAdvisorPrevisPatch(restored.spec,advisorPrevisPatchSchema.parse({kind:"previs_edit_v1",summaryZh:"清空道具",unsupportedZh:[],storyProps:[]})).storyProps).toEqual([]);
});
