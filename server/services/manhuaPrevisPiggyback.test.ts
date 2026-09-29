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
  it("短时滑落、接住和复位随草稿恢复，时间越界或乱序会被拦下", () => {
    const studio = fixture();
    studio.spec.piggyback!.slipCatch = {
      slipStartSec: .25, catchSec: .9, recoverEndSec: 1.8, dropMeters: .12,
    };
    const restored = manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio)));
    expect(restored.spec.piggyback?.slipCatch).toEqual(studio.spec.piggyback?.slipCatch);
    expect(manhuaPrevisSpecSchema.safeParse(restored.spec).success).toBe(true);
    for (const patch of [
      { catchSec: .3 },
      { recoverEndSec: 2.2 },
      { dropMeters: .3 },
    ]) {
      const bad = structuredClone(studio.spec);
      bad.piggyback!.slipCatch = { ...bad.piggyback!.slipCatch!, ...patch };
      expect(manhuaPrevisSpecSchema.safeParse(bad).success).toBe(false);
    }
  });
});

it("完整放下保持同一人物并允许放下后走位，拒绝移动中放下及乱序",()=>{
 const s=fixture().spec; s.durationSec=5;s.cameras[0].endSec=5;
 for(const a of s.actors){a.moveEndSec=1;a.actions=[{kind:a.id==='carrier'?'walk':'idle',startSec:0,endSec:1}];}
 s.piggyback!.setDown={startSec:1,groundSec:2,releaseSec:2.5,endSec:3};
 expect(manhuaPrevisSpecSchema.safeParse(s).success).toBe(true);
 const bad=structuredClone(s);bad.piggyback!.setDown!.groundSec=.5;
 expect(manhuaPrevisSpecSchema.safeParse(bad).success).toBe(false);
 const moving=structuredClone(s);for(const a of moving.actors)a.moveEndSec=4;
 expect(manhuaPrevisSpecSchema.safeParse(moving).success).toBe(false);
});
it("四足受击必须绑定真实出掌人物与接触时刻",()=>{
 const s=createManhuaPrevisStudio(5).spec;
 const source=s.actors[0];source.actions=[{kind:'strike',startSec:1,endSec:3}];
 const horse={...structuredClone(source),id:'horse',nameZh:'墨屠',shape:'horse' as const,actions:[],hitReaction:{sourceActorId:source.id,startSec:1.5,contactSec:2,endSec:3}};
 s.actors.push(horse);
 expect(manhuaPrevisSpecSchema.safeParse(s).success).toBe(true);
 horse.hitReaction.sourceActorId='missing';
 expect(manhuaPrevisSpecSchema.safeParse(s).success).toBe(false);
});
