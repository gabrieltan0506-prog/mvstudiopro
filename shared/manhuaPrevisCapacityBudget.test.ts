import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema, PREVIS_MAX_ACTORS, PREVIS_RENDER_UNIT_BUDGET, previsRenderCostUnits } from "./manhuaPrevis";
import { assignPrevisActorColors, PREVIS_ACTOR_COLORS } from "./manhuaPrevisColors";
import { advisorPrevisPatchSchema } from "./manhuaAdvisorPrevisEdit";
import { previsReportSchema } from "../server/services/manhuaPrevisReport";
import { routeReportSchema } from "../server/services/manhuaPrevisRouteReport";
import { buildBoatFight, MAN } from "./manhuaActionPlanBoatFightFixture";
import { sealManhuaActionPlan } from "./manhuaActionPlan";
import { splitManhuaActionPlanForPrevis } from "./manhuaActionPlanSplit";

const studioFor = (count: number, seconds: number) => {
  const studio = createManhuaPrevisStudio(seconds);
  studio.spec.actors = Array.from({length: count}, (_, i) => ({ ...studio.spec.actors[0], id: `actor-${i}`, nameZh: `演员${i}`, colorIndex: i }));
  return studio;
};
describe("人数由原预算推导", () => {
  it("预算内颜色稳定唯一，超容量明确失败", () => {
    const actors: Array<{ id: string; colorIndex?: number }> = Array.from({ length: PREVIS_MAX_ACTORS }, (_, i) => ({ id: `actor-${i}` }));
    const assigned = assignPrevisActorColors(actors);
    expect(new Set(assigned.map(a => a.colorIndex)).size).toBe(PREVIS_MAX_ACTORS);
    expect(assignPrevisActorColors([...actors].reverse(), assigned).reverse()).toEqual(assigned);
    expect(() => assignPrevisActorColors([...actors, { id: "ninth" }])).toThrow("渲染预算");
    expect(PREVIS_ACTOR_COLORS).toHaveLength(PREVIS_MAX_ACTORS);
    expect(new Set(PREVIS_ACTOR_COLORS.map(color => color.hex)).size).toBe(PREVIS_MAX_ACTORS);
  });
  it.each([[7,16,true],[7,17,false],[9,12,true],[9,13,false],[58,2,true],[59,2,false]] as const)("%i人%i秒生产门禁=%s", (count, seconds, ok) => {
    expect(PREVIS_RENDER_UNIT_BUDGET).toBe(2800);
    expect(manhuaPrevisSpecSchema.safeParse(studioFor(count, seconds).spec).success).toBe(ok);
  });
  it("恢复预算内全部身份与颜色，超容量拒绝；画外不扣减预算", () => {
    const studio = studioFor(58, 2);
    expect(manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio))).spec.actors).toEqual(studio.spec.actors);
    expect(manhuaPrevisStudioSchema.safeParse(studioFor(59, 2)).success).toBe(false);
    studio.spec.actors.forEach(a => a.visibleRanges = [{ startSec: 0, endSec: 1 }]);
    expect(previsRenderCostUnits(studio.spec)).toBe(2784);
    expect(manhuaPrevisSpecSchema.safeParse({...studio.spec, durationSec:3}).success).toBe(false);
  });
  it("顾问及恢复报告保留预算内所有演员并拒绝结构超界", () => {
    const actors = studioFor(PREVIS_MAX_ACTORS,2).spec.actors;
    const patch = {kind:"previs_edit_v1", summaryZh:"保持演员", unsupportedZh:[], actors:actors.map(a => ({id:a.id}))};
    expect(advisorPrevisPatchSchema.safeParse(patch).success).toBe(true);
    expect(advisorPrevisPatchSchema.safeParse({...patch, actors:[...patch.actors,{id:"ninth"}]}).success).toBe(false);
    const report = {frames:48, fps:24, actors:actors.map(a => ({id:a.id,nameZh:a.nameZh,bones:16,contactError:0,stanceDrift:0,offscreenFrames:[]})),warnings:[]};
    expect(previsReportSchema.parse(report).actors).toHaveLength(PREVIS_MAX_ACTORS);
    expect(previsReportSchema.safeParse({...report, actors:[...report.actors,{...report.actors[0],id:"ninth"}]}).success).toBe(false);
    const routes = actors.map(a => ({actorId:a.id,samples:Array.from({length:48},(_,i)=>({frame:i+1,root:[0,0,0],facingDeg:0}))}));
    expect(routeReportSchema.parse(routes)).toHaveLength(PREVIS_MAX_ACTORS);
    expect(routeReportSchema.safeParse([...routes,{...routes[0],actorId:"ninth"}]).success).toBe(false);
  });
  it.each([9,10])("拆镜器按时长预算而非固定人数放行：%i人", count => {
    const plan=buildBoatFight();
    plan.actors=Array.from({length:count},(_,i)=>({actorId:`cast${i}`,nameZh:`演员${i}`}));
    const state=plan.initialStates[MAN];
    plan.initialStates=Object.fromEntries(plan.actors.map(a=>[a.actorId,{...state,heldProps:[]}]));
    plan.shots=[{...plan.shots[0],actorChanges:[],events:[],timeMap:{sourceDurationSec:12,spans:[]}}];
    const result=splitManhuaActionPlanForPrevis(sealManhuaActionPlan(plan));
    if(count===9) expect(result.shots[0].onstageActorIds).toHaveLength(9);
    else { expect(result.shots).toHaveLength(0);expect(result.issues.some(i=>i.code==="too_many_actors_for_shot" && i.messageZh.includes("最多 9 人"))).toBe(true); }
  });
});
