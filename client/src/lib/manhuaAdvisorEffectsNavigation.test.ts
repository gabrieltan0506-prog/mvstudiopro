import { expect, it, vi } from "vitest";
import { executeAdvisorEffectsWhenReady } from "./manhuaAdvisorEffectsNavigation";
import type { AdvisorEffectsControl } from "@shared/manhuaAdvisorEffects";

it("目标控件仍是上一片段时只读身份，切到确切片段后才执行", async () => {
  const old: AdvisorEffectsControl = vi.fn(async () => JSON.stringify({ clipId: "clip-old", sourceKey: "old" }));
  const target: AdvisorEffectsControl = vi.fn(async action => action.operation === "inspect" ? JSON.stringify({ clipId: "clip-target", sourceKey: "target" }) : "已配置目标");
  let current = old;
  const backup = vi.fn();
  expect(await executeAdvisorEffectsWhenReady({ action: { action: "effects", tool: "scene", operation: "configure", clipId: "clip-target", sourceKey: "target", sceneEffects: [] }, signal: new AbortController().signal, getControl: () => current, isCurrent: () => true, beforeMutation: backup, wait: async () => { current = target; } })).toBe("已配置目标");
  expect(old).toHaveBeenCalledTimes(1); expect((old as ReturnType<typeof vi.fn>).mock.calls[0][0].operation).toBe("inspect");
  expect(target).toHaveBeenCalledTimes(2); expect(backup).toHaveBeenCalledTimes(1);
});

it("身份读取期间换项目或中止时不执行，也不制作备份", async () => {
  for (const stop of ["scope", "abort"] as const) {
    const abort = new AbortController(); let active = true;
    const control: AdvisorEffectsControl = vi.fn(async () => { if (stop === "scope") active = false; else abort.abort(); return JSON.stringify({ clipId: "clip-target", sourceKey: "key" }); });
    const backup = vi.fn();
    await expect(executeAdvisorEffectsWhenReady({ action: { action: "effects", tool: "generative", operation: "submit", clipId: "clip-target", sourceKey: "key" }, signal: abort.signal, getControl: () => control, isCurrent: () => active, beforeMutation: backup })).rejects.toThrow();
    expect(control).toHaveBeenCalledTimes(1); expect(backup).not.toHaveBeenCalled();
  }
});
