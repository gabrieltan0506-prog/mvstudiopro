import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assignPrevisActorColors, PREVIS_ACTOR_COLORS, previsActorColor } from "./manhuaPrevisColors";

describe("白模角色颜色", () => {
  it("新增、删除演员保留其他人的颜色", () => {
    const original = assignPrevisActorColors([{ id: "b" }, { id: "d" }]);
    const next = assignPrevisActorColors([...original, { id: "a" }], original);
    expect(previsActorColor("b", next)).toEqual(previsActorColor("b", original));
    expect(previsActorColor("d", next.filter(a => a.id !== "b"))).toEqual(previsActorColor("d", original));
  });
  it("六个人各有颜色，重排角色不会换色，渲染器使用同一色板", () => {
    const actors = ["d", "b", "f", "a", "c", "e"].map(id => ({ id }));
    expect(new Set(actors.map(a => previsActorColor(a.id, actors).hex)).size).toBe(6);
    for (const actor of actors) expect(previsActorColor(actor.id, actors)).toEqual(previsActorColor(actor.id, [...actors].reverse()));
    const renderer = readFileSync("server/scripts/render-manhua-previs.py", "utf8");
    expect(renderer).toContain(`actor_palette = [${PREVIS_ACTOR_COLORS.map(c => `'${c.hex.slice(1)}'`).join(", ")}]`);
  });
});
