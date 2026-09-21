import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema } from "../../shared/manhuaPrevis";

function fixture() {
  const studio = createManhuaPrevisStudio(2);
  const carrier = { ...studio.spec.actors[0], id: "carrier", nameZh: "承载者", start: [0, 0] as [number, number], end: [.35, 0] as [number, number], moveStartSec: 0, moveEndSec: 2,
    actions: [{ kind: "walk" as const, startSec: 0, endSec: 2 }] };
  studio.spec.actors = [carrier, { ...structuredClone(carrier), id: "passenger", nameZh: "乘员", actions: [{ kind: "idle", startSec: 0, endSec: 2 }] }];
  studio.spec.piggyback = { carrierId: "carrier", passengerId: "passenger" };
  return studio;
}

describe("整段背负配置和草稿恢复", () => {
  it("序列化恢复双方身份与跟随关系，旧稿不凭空增加背负", () => {
    const studio = fixture();
    const restored = manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio)));
    expect(restored.spec.piggyback).toEqual(studio.spec.piggyback);
    expect(manhuaPrevisSpecSchema.safeParse(restored.spec).success).toBe(true);
    delete studio.spec.piggyback;
    expect(manhuaPrevisStudioSchema.parse(studio).spec.piggyback).toBeUndefined();
  });
  it("错人物、独立路线、乘员叠动作和四足角色不能提交", () => {
    for (const mutate of [
      (s: ReturnType<typeof fixture>) => { s.spec.piggyback!.passengerId = "missing"; },
      (s: ReturnType<typeof fixture>) => { s.spec.piggyback!.passengerId = "carrier"; },
      (s: ReturnType<typeof fixture>) => { s.spec.actors[1].end = [1, 1]; },
      (s: ReturnType<typeof fixture>) => { s.spec.actors[1].actions[0].kind = "cough"; },
      (s: ReturnType<typeof fixture>) => { s.spec.actors[1].shape = "horse"; },
    ]) {
      const s = fixture(); mutate(s);
      expect(manhuaPrevisSpecSchema.safeParse(s.spec).success).toBe(false);
    }
  });
});
