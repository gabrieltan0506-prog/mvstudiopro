import { describe, expect, it } from "vitest";
import { manhuaDirectionSelectionForRequest } from "../shared/manhuaDirectionCanonLibrary";
import type { ManhuaDirectionOverride } from "../shared/manhuaDirectionCanon";
import { manhuaDirectionSelectionInputSchema } from "./manhuaDirectionSelectionSchema";

describe("导演包选卡入参（审查 P0：副卡必须是可缺省的 partialRecord）", () => {
  it("只选主卡 / 选一张副卡 / 空副卡对象 都能通过；未知场景类型与坏阶段被拒", () => {
    expect(manhuaDirectionSelectionInputSchema.safeParse({ mainCardId: "a" }).success).toBe(true);
    const one = manhuaDirectionSelectionInputSchema.safeParse({ mainCardId: "a", sceneOverrides: { action: { cardId: "b" } } });
    expect(one.success).toBe(true);
    expect(one.success && one.data.sceneOverrides).toEqual({ action: { cardId: "b" } });
    expect(manhuaDirectionSelectionInputSchema.safeParse({ mainCardId: "a", sceneOverrides: {} }).success).toBe(true);
    expect(manhuaDirectionSelectionInputSchema.safeParse({ mainCardId: "a", sceneOverrides: { action: { cardId: "b", stages: ["clip", "review"] } } }).success).toBe(true);
    expect(manhuaDirectionSelectionInputSchema.safeParse({ mainCardId: "a", sceneOverrides: { comedy: { cardId: "b" } } }).success).toBe(false);
    expect(manhuaDirectionSelectionInputSchema.safeParse({ mainCardId: "a", sceneOverrides: { action: { cardId: "b", stages: ["nope"] } } }).success).toBe(false);
  });
});

 it("局部范围经真实API schema不丢失，缺镜身份被拒绝", () => {
 const scopedOverrides = [{ scope: "shot", episodeIndex: 2, shotIndex: 4, cardId: "b", reasonZh: "门槛视线揭示代价", stages: ["clip"], status: "approved" }];
 expect(manhuaDirectionSelectionInputSchema.parse({mainCardId:"a",scopedOverrides}).scopedOverrides).toEqual(scopedOverrides);
 expect(manhuaDirectionSelectionInputSchema.safeParse({mainCardId:"a",scopedOverrides:[{...scopedOverrides[0],shotIndex:undefined}]}).success).toBe(false);
 });

it("出站范围身份与API一致，缺身份阻断而不丢覆盖", () => {
 const base = { episodeIndex: 1, cardId: "card", reasonZh: "转折", stages: ["clip"] as const, status: "approved" as const };
 const overrides: ManhuaDirectionOverride[] = [
  {...base, stages: [...base.stages], scope:"episode"},
  {...base, stages: [...base.stages], scope:"segment", segmentIndex:2},
  {...base, stages: [...base.stages], scope:"shot", shotIndex:3},
 ];
 const request = manhuaDirectionSelectionForRequest({mainCardId:"card", scopedOverrides:overrides});
 expect(manhuaDirectionSelectionInputSchema.parse(request).scopedOverrides).toEqual(overrides);
 expect(() => manhuaDirectionSelectionForRequest({mainCardId:"card", scopedOverrides:[{...overrides[2], shotIndex:undefined}]})).toThrow("镜头身份");
});
