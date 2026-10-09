import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { makeManhuaVfxEffect } from "../client/src/lib/manhuaVfxWorkflow";
import { creativeVoiceProductionSchema } from "./creativeVoiceProduction";
import { manhuaVfxCompositionSchema, manhuaVfxStateSchema, validateManhuaVfxSource } from "./manhuaVfx";
import { queueManhuaVfx, type VfxQueueDeps } from "../server/services/manhuaVfxTask";

it("梦境效果拒绝缺失/越界/错用参数与错误层序，TS和Python采样预算一致", () => {
  const meta = { width: 1920, height: 1080, fps: 30, durationSec: 30 };
  for (const kind of ["mirror_corridor", "floating_paper"] as const) {
    const effect = makeManhuaVfxEffect(kind, "dream");
    const group = kind === "mirror_corridor" ? "mirror" : "paper";
    for (const invalid of [{ ...effect, [group]: undefined }, { ...effect, [group]: { ...effect[group], extra: 1 } }, { ...effect, liquid: { amplitude: 0, frequency: 1, speed: 0, reflection: 0 } }]) {
      const recipe = { version: 1, seed: 1, effects: [invalid] };
      expect(manhuaVfxCompositionSchema.safeParse(recipe).success).toBe(false);
      expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: recipe }).success).toBe(false);
    }
    const reversed = { version: 1, seed: 1, effects: [makeManhuaVfxEffect("shield", "overlay"), effect] };
    expect(manhuaVfxCompositionSchema.safeParse(reversed).success).toBe(false);
    expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: reversed }).success).toBe(false);
    const large = { ...effect, durationSec: 30, scale: 2, ...(effect.paper ? { paper: { ...effect.paper, count: 64, size: .12 } } : {}) };
    const recipe = manhuaVfxCompositionSchema.parse({ version: 1, seed: 42, effects: [large] });
    expect(() => validateManhuaVfxSource(recipe, meta)).toThrow("预算超限");
    expect(() => execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_liquid_ghost import validate_processing_spec;validate_processing_spec(json.load(sys.stdin))"], { input: JSON.stringify({ ...recipe, ...meta }), stdio: ["pipe", "pipe", "pipe"] })).toThrow();
  }
});

it.each(["prop_scene", "cup_fracture", "fruit_stall_fracture", "city_fold", "mirror_corridor", "floating_paper", "liquid_mirror", "motion_ghost", "wall_fracture", "bullet_wave", "directed_blast"] as const)("%s顾问/保存JSON/幂等任务与真实Python消费者参数一致", async kind => {
  const effect = makeManhuaVfxEffect(kind, "source-effect");
  if (effect.world) effect.world = { ...effect.world, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" };
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
  const consumer = effect.world ? "import sys,json,tempfile,pathlib,hashlib;sys.path.insert(0,'server/scripts');from manhua_vfx_world_props import validate_world_spec;s=json.load(sys.stdin);e=s['effects'][0];tmp=tempfile.TemporaryDirectory();root=pathlib.Path(tmp.name);(root/'scenes').mkdir();p=root/'scenes'/('scene-'+e['id']+'.blend');p.write_bytes(b'BLENDER_TEST_ONLY');e['scenePath']=str(p);e['sceneSha256']=hashlib.sha256(p.read_bytes()).hexdigest();validate_world_spec(s,e['id'],root);e.pop('scenePath');e.pop('sceneSha256');print(json.dumps(s))" : "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import validate_spec;print(json.dumps(validate_spec(json.load(sys.stdin))))";
  const result = execFileSync("python3", ["-c", consumer], { input: JSON.stringify(spec), encoding: "utf8" });
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
