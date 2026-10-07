import { expect, it } from "vitest";
import { validateVfxManifest } from "./manhuaVfxRender";
import type { ManhuaVfxComposition } from "../../shared/manhuaVfx";
const recipe: ManhuaVfxComposition = { version: 1, seed: 1, effects: [{ id: "hit", kind: "impact_burst", startSec: .25, durationSec: .5, color: "#11CCFF", scale: .2, intensity: 1, anchor: { space: "screen", position: [.5,.5] } }] };
const manifest = { complete: true, width: 64, height: 64, fps: 12, frameCount: 12, alpha: "straight", colorSpace: "sRGB", files: Array.from({ length: 12 }, (_, i) => ({ frame: i+1, path: `frame-${String(i+1).padStart(6,"0")}.png`, bytes: 10, sha256: "a".repeat(64) })), frames: Array.from({ length: 12 }, (_, i) => ({ frame: i+1, timeSec: i/12, effects: [{ id: "hit", kind: "impact_burst", active: i>=3 && i<9, progress: 0, opacity: 0, position: [.5,.5] }] })) };
it("requires every event in every real frame without sampling, wrong timing or duplicate identities", () => {
  const meta = { width: 64, height: 64, fps: 12, durationSec: 1 };
  expect(validateVfxManifest(manifest, recipe, meta).frames).toHaveLength(12);
  for (const mode of ["missing", "duplicate", "window", "time", "kind"]) {
    const bad = structuredClone(manifest);
    if (mode === "missing") bad.frames[5].effects = [];
    if (mode === "duplicate") bad.frames[5].effects.push(bad.frames[5].effects[0]);
    if (mode === "window") bad.frames[0].effects[0].active = true;
    if (mode === "time") bad.frames[5].timeSec = 0;
    if (mode === "kind") bad.frames[5].effects[0].kind = "shield";
    expect(() => validateVfxManifest(bad, recipe, meta)).toThrow();
  }
});
