import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  previsEffectsSchema,
  previsEffectsDraftSchema,
  validatePrevisEffects,
} from "./manhuaPrevisEffects";
const schema = z
  .object({
    durationSec: z.number(),
    actors: z.array(z.unknown()),
    effects: previsEffectsSchema.optional(),
  })
  .superRefine(validatePrevisEffects);
const effect = {
  id: "flash",
  kind: "explosion" as const,
  startSec: 0.5,
  durationSec: 1,
  origin: [0, 0, 0] as [number, number, number],
  radius: 1,
  height: 2,
  wind: [0.5, 0] as [number, number],
};
const fixture = () => ({
  durationSec: 2,
  actors: [{}],
  effects: [structuredClone(effect)],
});
describe("特效边界", () => {
  it("接受有限事件及完整草稿字段", () => {
    expect(schema.parse(fixture()).effects).toEqual([effect]);
    expect(previsEffectsDraftSchema.parse([effect])).toEqual([effect]);
  });
  it.each([
    ["重复ID", () => ({ ...fixture(), effects: [effect, effect] })],
    ["超角色", () => ({ ...fixture(), actors: [{}, {}, {}, {}] })],
    ["超时长", () => ({ ...fixture(), durationSec: 9 })],
    [
      "亚帧开始",
      () => ({ ...fixture(), effects: [{ ...effect, startSec: 0.51 }] }),
    ],
    [
      "亚帧长度",
      () => ({ ...fixture(), effects: [{ ...effect, durationSec: 1.01 }] }),
    ],
    [
      "末帧外",
      () => ({ ...fixture(), effects: [{ ...effect, durationSec: 1.5 }] }),
    ],
    ["超半径", () => ({ ...fixture(), effects: [{ ...effect, radius: 3.1 }] })],
    [
      "非有限风",
      () => ({ ...fixture(), effects: [{ ...effect, wind: [NaN, 0] }] }),
    ],
    [
      "未知字段",
      () => ({ ...fixture(), effects: [{ ...effect, python: "print(1)" }] }),
    ],
  ] as const)("拒收%s", (_, make) =>
    expect(schema.safeParse(make()).success).toBe(false)
  );
  it("草稿保留暂时越界数字供编辑，提交仍拒收", () => {
    const draft = [{ ...effect, radius: 0, durationSec: 0 }];
    expect(previsEffectsDraftSchema.parse(draft)).toEqual(draft);
    expect(previsEffectsSchema.safeParse(draft).success).toBe(false);
  });
  it("无特效保持旧场景时长角色边界不受此模块限制", () =>
    expect(
      schema.safeParse({ durationSec: 30, actors: Array(6).fill({}) }).success
    ).toBe(true));
});
