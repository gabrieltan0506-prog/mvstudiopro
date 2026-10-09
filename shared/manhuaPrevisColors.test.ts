import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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
    const colors = JSON.parse(execFileSync("python3", ["-c", `import sys,json;sys.path.insert(0,'server/scripts');from previs_actor_colors import actor_color_hex;print(json.dumps([actor_color_hex(i) for i in range(${PREVIS_ACTOR_COLORS.length})]))`], {encoding:"utf8"}));
    expect(colors).toEqual(PREVIS_ACTOR_COLORS.map(c => c.hex.slice(1)));
  });
});
