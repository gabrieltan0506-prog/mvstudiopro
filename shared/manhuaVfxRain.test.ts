import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { makeManhuaVfxEffect } from "../client/src/lib/manhuaVfxWorkflow";
import { creativeVoiceProductionSchema } from "./creativeVoiceProduction";
import { manhuaVfxCompositionSchema, manhuaVfxStateSchema, mergeManhuaVfxState } from "./manhuaVfx";
import { queueManhuaVfx, type VfxQueueDeps } from "../server/services/manhuaVfxTask";

it("数字雨从顾问到保存、请求与Python参数完整一致，重复请求不重建任务", async () => {
  const effect = { ...makeManhuaVfxEffect("digital_rain", "rain"), rain: { columns: 32, speed: .47, trail: 15 } };
  const composition = manhuaVfxCompositionSchema.parse({ version: 1, seed: 42, effects: [effect] });
  const action = creativeVoiceProductionSchema.parse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "source-v1", sourceIds: ["clip"], vfxRecipe: composition });
  expect(action).toMatchObject({ vfxRecipe: composition });
  const draft = { sourceId: "clip", sourceKey: "source-v1", videoUri: "gs://test-bucket/source.mp4", composition };
  const id = "10090000-1234-4234-8234-123456789abc";
  const state = manhuaVfxStateSchema.parse({ version: 1, scopeKey: "scope", draft, requests: { [id]: { ...draft, requestId: id, createdAt: 1, status: "unknown" } } });
  expect(mergeManhuaVfxState(state, JSON.parse(JSON.stringify(state)))).toEqual(state);
  let saved: Parameters<VfxQueueDeps["insert"]>[2] | undefined;
  let writes = 0;
  const deps: VfxQueueDeps = { load: async jobId => saved ? { id: jobId, userId: "7", type: "post_prod", status: "queued", input: saved } : null,
    insert: async (_id, _user, input) => { saved = input; writes++; } };
  const request = { action: "manhua_vfx" as const, requestId: id, scopeKey: "scope", params: { videoUri: draft.videoUri, sourceKey: draft.sourceKey, composition } };
  const first = await queueManhuaVfx("7", request, deps);
  expect(await queueManhuaVfx("7", request, deps)).toEqual(first);
  expect(writes).toBe(1);
  expect(saved).toEqual(request);
  await expect(queueManhuaVfx("7", { ...request, params: { ...request.params, composition: { ...composition, effects: [{ ...effect, rain: { ...effect.rain, speed: .5 } }] } } }, deps)).rejects.toThrow("同一请求编号");
  const spec = { ...composition, durationSec: 3, fps: 24, width: 640, height: 360 };
  const python = execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import validate_spec;print(json.dumps(validate_spec(json.load(sys.stdin))))"], { input: JSON.stringify(spec), encoding: "utf8" });
  expect(JSON.parse(python)).toEqual(spec);
});

it("数字雨默认值跨语言一致，超限及混用参数在顾问和工作流同时拒绝", () => {
  const effect = makeManhuaVfxEffect("digital_rain", "rain");
  const defaults = JSON.parse(execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_rain_math import DEFAULTS;print(json.dumps(DEFAULTS))"], { encoding: "utf8" }));
  expect(effect.rain).toEqual(defaults);
  for (const update of [{ columns: 37 }, { columns: 8.5 }, { trail: 17 }, { speed: 0 }, { speed: Infinity }]) {
    const recipe = { version: 1, seed: 1, effects: [{ ...effect, rain: { ...effect.rain, ...update } }] };
    expect(manhuaVfxCompositionSchema.safeParse(recipe).success).toBe(false);
    expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: recipe }).success).toBe(false);
  }
  const mixed = { version: 1, seed: 1, effects: [{ ...effect, kind: "shield" }] };
  expect(manhuaVfxCompositionSchema.safeParse(mixed).success).toBe(false);
  expect(creativeVoiceProductionSchema.safeParse({ action: "effects", tool: "vfx", operation: "configure", sourceKey: "current", sourceIds: ["clip"], vfxRecipe: mixed }).success).toBe(false);
});
