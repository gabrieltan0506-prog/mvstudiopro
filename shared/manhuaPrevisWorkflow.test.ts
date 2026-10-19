import { expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, formatPrevisMotionGuide, previsRenderCostUnits } from "./manhuaPrevis";
import { previsStoryPropSchema, storyPropsIssue } from "./manhuaPrevisStoryProps";
import { advisorPrevisPatchSchema, applyAdvisorPrevisPatch } from "./manhuaAdvisorPrevisEdit";
function chair() {
  return previsStoryPropSchema.parse({ id: "chair", kind: "chair_burst_text", proxy: { size: [.52, .5, 1.1], color: [.4, .3, .2],
    burst: { startSec: 19.4, burstEndSec: 20.3, gatherStartSec: 21, gatherEndSec: 24, text: "真人把关", textPosition: [-.5, 0, 1.2], textWidth: 1.15 } },
    keyframes: [0, 29.7].map(timeSec => ({ timeSec, anchor: { type: "world", position: [0, 0, 0] } })) });
}
it("完整场景动作通过顾问候选与严格规格，生成指引保留爆裂/聚字秒位", () => {
  const spec = createManhuaPrevisStudio(29.7).spec;
  const patch = advisorPrevisPatchSchema.parse({ kind: "previs_edit_v1", summaryZh: "完整椅子爆裂后聚字", unsupportedZh: [], storyProps: [chair()] });
  const changed = applyAdvisorPrevisPatch(spec, patch);
  const restored = manhuaPrevisSpecSchema.parse(JSON.parse(JSON.stringify(changed)));
  expect(restored.storyProps).toEqual([chair()]);
  expect(formatPrevisMotionGuide(restored)).toContain('19.4—20.3秒爆裂');
  expect(formatPrevisMotionGuide(restored)).toContain('21—24秒同一批碎片聚为“真人把关”');
  expect(previsRenderCostUnits({ ...spec, storyProps: Array(5).fill(chair()) })).toBeGreaterThan(previsRenderCostUnits({ ...spec, storyProps: Array(5).fill({ kind: "stage_box" }) }));
});
it("不允许倒序爆裂、跨片聚字、其他道具夹带动作和任意字体路径", () => {
  const p = chair(); p.proxy!.burst!.gatherStartSec = 19;
  expect(storyPropsIssue([p], [], 29.7)).toMatch(/依序/);
  p.proxy!.burst!.gatherStartSec = 21; p.proxy!.burst!.gatherEndSec = 29.7;
  expect(storyPropsIssue([p], [], 29.7)).toMatch(/结尾文字/);
  const wrong = chair(); wrong.kind = "stage_box";
  expect(storyPropsIssue([wrong], [], 29.7)).toMatch(/其他道具/);
  expect(previsStoryPropSchema.safeParse({ ...chair(), proxy: { ...chair().proxy, fontPath: "/tmp/untrusted-font" } }).success).toBe(false);
});
it("中文卡片和九镜小数秒可保存，路线必须覆盖实际片尾", () => {
  const spec = createManhuaPrevisStudio(28.8).spec;
  expect(manhuaPrevisSpecSchema.safeParse({ ...spec, durationSec: 28.81 }).success).toBe(false);
  spec.cameras = Array.from({ length: 9 }, (_, i) => ({ ...spec.cameras[0], startSec: i * 3.2, endSec: (i + 1) * 3.2 }));
  spec.cameras.at(-1)!.endSec = 28.8;
  spec.storyProps = [previsStoryPropSchema.parse({ id: "card", kind: "information_panel", proxy: { size: [.6, .03, .4], color: [.4, .5, .6], label: "待核实" }, keyframes: [0, 28.8].map(timeSec => ({ timeSec, anchor: { type: "world", position: [0, 0, 1] } })) })];
  const actor = spec.actors[0]; actor.motionRoute = [0, 28.8].map(timeSec => ({ timeSec, position: actor.start, facingDeg: actor.facingDeg }));
  expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  actor.motionRoute[1].timeSec = 28;
  expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
});
