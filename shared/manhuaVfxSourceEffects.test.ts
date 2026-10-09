import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { makeManhuaVfxEffect } from "../client/src/lib/manhuaVfxWorkflow";
import { creativeVoiceProductionSchema } from "./creativeVoiceProduction";
import { manhuaVfxCompositionSchema, manhuaVfxStateSchema, validateManhuaVfxSource } from "./manhuaVfx";
import { queueManhuaVfx, type VfxQueueDeps } from "../server/services/manhuaVfxTask";

it.each(["liquid_mirror", "motion_ghost", "wall_fracture", "bullet_wave", "directed_blast"] as const)("%s顾问/保存JSON/幂等任务与真实Python消费者参数一致", async kind => {
  const effect = makeManhuaVfxEffect(kind, "source-effect");
  const composition = manhuaVfxCompositionSchema.parse({ version: 1, seed: 42, effects: [effect] });
  expect(creativeVoiceProductionSchema.parse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: composition })).toMatchObject({ vfxRecipe: composition });
  const id = "10091111-1234-4234-8234-123456789abc", params = { videoUri: "gs://test-bucket/source.mp4", sourceKey: "current", composition };
  const state = manhuaVfxStateSchema.parse(JSON.parse(JSON.stringify({ version: 1, scopeKey: "scope", draft: { ...params, sourceId: "clip" }, requests: { [id]: { ...params, sourceId: "clip", requestId: id, createdAt: 1, status: "unknown" } } })));
  expect(state.draft?.composition).toEqual(composition);
  let stored: unknown, writes = 0;
  const deps: VfxQueueDeps = { load: async jobId => stored ? { id: jobId, userId: "7", type: "post_prod", status: "queued", input: stored } : null, insert: async (_id, _user, input) => { stored = input; writes++; } };
  const request = { action: "manhua_vfx", requestId: id, scopeKey: "scope", params };
  expect(await queueManhuaVfx("7", request, deps)).toEqual(await queueManhuaVfx("7", request, deps)); expect(writes).toBe(1);
  const spec = { ...composition, durationSec: 3, fps: 24, width: 640, height: 360 };
  const result = execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import validate_spec;print(json.dumps(validate_spec(json.load(sys.stdin))))"], { input: JSON.stringify(spec), encoding: "utf8" });
  expect(JSON.parse(result)).toEqual(spec);
});

it("流动符号参数跨语言完整、旧数字雨仍兼容，顾问拒绝不适用字段与错误层序", () => {
  const effect = { ...makeManhuaVfxEffect("digital_rain", "rain"), rain: { columns: 24, speed: .5, trail: 12, glyphSet: "custom", characters: "天地乾坤", layout: "wall", direction: "left", glyphRate: 2 } };
  const composition = manhuaVfxCompositionSchema.parse({ version: 1, seed: 3, effects: [effect] });
  const spec = { ...composition, durationSec: 3, fps: 24, width: 640, height: 360 };
  expect(JSON.parse(execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import validate_spec;print(json.dumps(validate_spec(json.load(sys.stdin))))"], { input: JSON.stringify(spec), encoding: "utf8" }))).toEqual(spec);
  for (const invalid of [ { ...effect, rain: { ...effect.rain, characters: "" } }, { ...effect, rain: { ...effect.rain, direction: "diagonal" } }, { ...effect, kind: "shield" }, { ...makeManhuaVfxEffect("liquid_mirror", "liquid"), ghost: makeManhuaVfxEffect("motion_ghost", "ghost").ghost } ]) {
    const recipe = { version: 1, seed: 1, effects: [invalid] };
    expect(manhuaVfxCompositionSchema.safeParse(recipe).success).toBe(false);
    expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: recipe }).success).toBe(false);
  }
  const reversed = { version: 1, seed: 1, effects: [effect, makeManhuaVfxEffect("liquid_mirror", "liquid")] };
  expect(manhuaVfxCompositionSchema.safeParse(reversed).success).toBe(false);
  expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: reversed }).success).toBe(false);
});

it("三维环绕拒绝旧单片参数、空场景、短窗及二维效果重叠", () => {
  const effect = makeManhuaVfxEffect("bullet_time", "orbit");
  expect(manhuaVfxCompositionSchema.safeParse({ version: 1, seed: 1, effects: [effect] }).success).toBe(false);
  const bullet = { ...effect, bullet: { ...effect.bullet!, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" } };
  const recipe = manhuaVfxCompositionSchema.parse({ version: 1, seed: 1, effects: [bullet] });
  expect(() => validateManhuaVfxSource(recipe, { durationSec: 3, fps: 24, width: 640, height: 360 })).not.toThrow();
  expect(() => validateManhuaVfxSource({ ...recipe, effects: [{ ...bullet, durationSec: .1 }] }, { durationSec: 3, fps: 24, width: 640, height: 360 })).toThrow("过短");
  expect(manhuaVfxCompositionSchema.safeParse({ ...recipe, effects: [{ ...bullet, bullet: { freezeSec: 0, yawDeg: 8, pushIn: .08 } }] }).success).toBe(false);
  expect(manhuaVfxCompositionSchema.safeParse({ ...recipe, effects: [bullet, makeManhuaVfxEffect("shield", "shield")] }).success).toBe(false);
});

it("动作特效拒绝串用参数、错误层序和起爆后无帧", () => {
  const wave = makeManhuaVfxEffect("bullet_wave", "wave"), blast = makeManhuaVfxEffect("directed_blast", "blast");
  const recipe = (effects: unknown[]) => ({ version: 1, seed: 1, effects });
  for (const bad of [{ ...wave, blast: blast.blast }, { ...blast, wave: wave.wave }, { ...wave, wave: { ...wave.wave, rings: 11 } }, { ...blast, blast: { ...blast.blast, ignitionSec: 1 } }]) {
    expect(manhuaVfxCompositionSchema.safeParse(recipe([bad])).success).toBe(false);
  }
  expect(manhuaVfxCompositionSchema.safeParse(recipe([blast, wave])).success).toBe(false);
  expect(manhuaVfxCompositionSchema.safeParse(recipe([wave, blast])).success).toBe(true);
  const nearEnd = manhuaVfxCompositionSchema.parse(recipe([{ ...blast, blast: { ...blast.blast, ignitionSec: .99 } }]));
  expect(() => validateManhuaVfxSource(nearEnd, { durationSec: 2, fps: 24, width: 640, height: 360 })).toThrow("起爆后");
});
