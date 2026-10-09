import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { makeManhuaVfxEffect } from "../client/src/lib/manhuaVfxWorkflow";
import { manhuaVfxCompositionSchema, validateManhuaVfxSource } from "./manhuaVfx";
import { creativeVoiceProductionSchema } from "./creativeVoiceProduction";

const recipe = (effect: unknown) => ({ version: 1, seed: 1009, effects: [effect] });
const meta = { durationSec: 4, width: 640, height: 360, fps: 24 };
const python = (effect: unknown, fps = meta.fps) => execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import validate_spec;validate_spec(json.load(sys.stdin))"], { input: JSON.stringify({ ...recipe(effect), ...meta, fps }), stdio: ["pipe", "pipe", "pipe"] });

it("三维道具与街区拒绝错字段、空生产参数、不可见最后爆点和翻折完成帧", () => {
  for (const kind of ["cup_fracture", "fruit_stall_fracture", "city_fold"] as const) {
    const effect = makeManhuaVfxEffect(kind, "shape");
    const group = kind === "city_fold" ? "city" : "prop";
    for (const bad of [{ ...effect, [group]: undefined }, { ...effect, [group]: { ...effect[group], arbitraryPath: "/tmp/model" } },
      { ...effect, kind: "shield" }]) {
      expect(manhuaVfxCompositionSchema.safeParse(recipe(bad)).success).toBe(false);
      expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: recipe(bad) }).success).toBe(false);
      expect(() => python(bad)).toThrow();
    }
    const nearEnd = kind === "city_fold" ? { ...effect, city: { ...effect.city!, foldEndSec: 2.999 } }
      : { ...effect, prop: { ...effect.prop!, holdStartSec: .8, holdDurationSec: .1 } };
    const fps = kind === "city_fold" ? 24 : 12;
    expect(() => validateManhuaVfxSource(manhuaVfxCompositionSchema.parse(recipe(nearEnd)), { ...meta, fps })).toThrow(kind === "city_fold" ? "没有可见" : "至少需要两帧");
    expect(() => python(nearEnd, fps)).toThrow();
  }
});

it("果摊分组总时间、杯子单爆点和街区独立三维窗使用同一门禁", () => {
  const cup = makeManhuaVfxEffect("cup_fracture", "cup"), fruit = makeManhuaVfxEffect("fruit_stall_fracture", "fruit"), city = makeManhuaVfxEffect("city_fold", "city");
  for (const bad of [{ ...cup, prop: { ...cup.prop!, staggerSec: .1 } }, { ...fruit, prop: { ...fruit.prop!, impactSec: 2, staggerSec: .5 } },
    { ...city, scale: .5 }, { ...city, anchor: { ...city.anchor, trajectory: [{ timeSec: 0, x: .5, y: .5 }, { timeSec: 2, x: .6, y: .5 }] } },
    { ...city, city: { ...city.city!, foldEndSec: .1 } }]) {
    expect(manhuaVfxCompositionSchema.safeParse(recipe(bad)).success).toBe(false); expect(() => python(bad)).toThrow();
  }
  expect(manhuaVfxCompositionSchema.safeParse({ ...recipe(city), effects: [cup, fruit, city] }).success).toBe(false);
  const sequence = { ...recipe(city), effects: [cup, { ...fruit, startSec: .5 }, { ...city, startSec: 4 }] };
  expect(manhuaVfxCompositionSchema.safeParse(sequence).success).toBe(true);
});
