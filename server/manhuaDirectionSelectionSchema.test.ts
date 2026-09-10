import { describe, expect, it } from "vitest";
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
