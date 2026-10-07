import { describe, expect, it } from "vitest";
import { manhuaVfxCompositionSchema, manhuaVfxStateSchema, validateManhuaVfxSource, type ManhuaVfxComposition } from "./manhuaVfx";
const composition: ManhuaVfxComposition = { version: 1, seed: 1, effects: [{ id: "trail", kind: "sword_trail", startSec: 0, durationSec: 1, color: "#00FFFF", scale: 0.25, intensity: 1, anchor: { space: "screen", position: [0.2, 0.8], trajectory: [{ timeSec: 0, x: 0.2, y: 0.8 }, { timeSec: 1, x: 0.8, y: 0.2 }] } }] };
describe("VFX actual source and evidence contract", () => {
  it("keeps the full authored trajectory and rejects code/duplicate or unordered recipes", () => {
    expect(manhuaVfxCompositionSchema.parse(composition)).toEqual(composition);
    expect(manhuaVfxCompositionSchema.safeParse({ ...composition, script: "bad" }).success).toBe(false);
    expect(manhuaVfxCompositionSchema.safeParse({ ...composition, effects: [...composition.effects, ...composition.effects] }).success).toBe(false);
    const bad = structuredClone(composition); bad.effects[0].anchor.trajectory![1].timeSec = 0;
    expect(manhuaVfxCompositionSchema.safeParse(bad).success).toBe(false);
  });
  it("requires real source bounds and at least one sampled frame, without extending windows", () => {
    const source = { durationSec: 2, width: 640, height: 360, fps: 24 };
    expect(() => validateManhuaVfxSource(composition, source)).not.toThrow();
    expect(() => validateManhuaVfxSource(composition, { ...source, durationSec: 0.5 })).toThrow("超出原片");
    const between = structuredClone(composition); between.effects[0].startSec = 0.01; between.effects[0].durationSec = 1 / 60;
    expect(() => validateManhuaVfxSource(between, source)).toThrow("任何视频帧");
    expect(between.effects[0].durationSec).toBe(1 / 60);
    expect(() => validateManhuaVfxSource(composition, { ...source, width: 3840 })).toThrow();
  });
  it("does not accept an adopted id without a saved request", () => {
    expect(manhuaVfxStateSchema.safeParse({ version: 1, scopeKey: "a", requests: {}, adoptedRequestId: "12345678-1234-4234-8234-123456789abc" }).success).toBe(false);
  });
});
