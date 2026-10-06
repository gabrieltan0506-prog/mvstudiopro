import { describe, expect, it } from "vitest";
import { createAdvisorScoringSourceGuard } from "./manhuaAdvisorScoringSource";
import { creativeVoiceProductionSchema } from "@shared/creativeVoiceProduction";
import { parseAdvisorWorkflowPlan } from "./manhuaAdvisorWorkflowPlan";

const source = () => ({
  scope: "project-1:script-1", clipId: "clip-A", musicId: "music-A",
  adoptedSettings: { durationSec: 3, volume: 0.5 }, sourceSettingsKey: "adopted-version-A",
  params: { videoUri: "gs://test/video-A.mp4", bgmUri: "gs://test/music-A.wav", bgmVolume: 0.5,
    bgmDurationSec: 3, duckUnderDialogue: false, entrySec: 1, bgmSeekSec: 0,
    volumeExpr: "0.5", fadeInSec: 0.2, fadeOutSec: 0.3,
    narrativeMix: [{ startSec: 1, endSec: 3, gainStart: 0.5, gainEnd: 0.8, role: "支持表演", noteZh: "测试" }] },
});
function guard() { let id = 0; return createAdvisorScoringSourceGuard(() => `test-version-${++id}`); }

describe("WF03-STALE-SCORING 混音候选来源", () => {
  it("相同来源渲染保持版本，候选只保存不含素材地址的版本", () => {
    const current = guard(); const key = current.update(source());
    expect(current.update(structuredClone(source()))).toBe(key);
    expect(() => current.assert(key)).not.toThrow();
    const action = creativeVoiceProductionSchema.parse({ action: "scoring", operation: "submit", sourceKey: key });
    const plan = parseAdvisorWorkflowPlan(JSON.stringify({ kind: "workflow_operation_v1", summaryZh: "混合A素材", action }));
    expect(plan.action).toEqual(action); expect(JSON.stringify(plan)).not.toContain("gs://");
  });
  it.each(["scope", "clipId", "musicId", "adoptedSettings", "sourceSettingsKey"] as const)("%s 改变后拒绝旧候选", field => {
    const current = guard(); const before = source(); const key = current.update(before);
    current.update({ ...before, [field]: field === "adoptedSettings" ? { durationSec: 2, volume: 0.8 } : "version-B" });
    expect(() => current.assert(key)).toThrow("已变化");
  });
  it.each(Object.keys(source().params))("实际请求参数 %s 改变后拒绝旧候选", field => {
    const current = guard(); const before = source(); const key = current.update(before);
    current.update({ ...before, params: { ...before.params, [field]: "changed" } });
    expect(() => current.assert(key)).toThrow("已变化");
  });
  it("A→B→A和卸载后恢复都不能复活旧候选", () => {
    const current = guard(); const keyA = current.update(source());
    current.update({ ...source(), clipId: "clip-B" }); const newA = current.update(source());
    expect(newA).not.toBe(keyA); expect(() => current.assert(keyA)).toThrow();
    const remounted = createAdvisorScoringSourceGuard(() => "another-session");
    remounted.update(source()); expect(() => remounted.assert(keyA)).toThrow();
  });
  it("旧的无来源候选、空版本和错误操作附带版本均拒绝", () => {
    const current = guard(); current.update(source()); expect(() => current.assert(undefined)).toThrow();
    for (const action of [
      { action: "scoring", operation: "submit" },
      { action: "scoring", operation: "submit", sourceKey: "" },
      { action: "scoring", operation: "inspect", sourceKey: "scoring:test" },
    ]) expect(creativeVoiceProductionSchema.safeParse(action).success).toBe(false);
  });
});
