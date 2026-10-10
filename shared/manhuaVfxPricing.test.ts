import { expect, it } from "vitest";
import { MANHUA_VFX_KINDS } from "./manhuaVfx";
import { MANHUA_VFX_CREDITS_PER_15_SECONDS, manhuaVfxCreditLabel, quoteManhuaVfxCredits } from "./manhuaVfxPricing";
it.each([[.01,8],[15,8],[15.001,16],[30,16],[30.001,20],[44.999,20],[45,24],[45.001,28],[59.999,28],[60,32],[75,40]])("%s秒按已确认整段及半价尾段计为%s积分", (seconds, credits) => {
  expect(quoteManhuaVfxCredits(["shield"], seconds).credits).toBe(credits);
});
it("全部效果有明确价格状态，已核价多层只取最高单价，不重复累加", () => {
  expect(Object.keys(MANHUA_VFX_CREDITS_PER_15_SECONDS).sort()).toEqual([...MANHUA_VFX_KINDS].sort());
  expect(quoteManhuaVfxCredits(["shield", "shield", "motion_ghost"], 31)).toEqual({ unitCredits: 16, units: 2.5, credits: 40 });
  expect(quoteManhuaVfxCredits(["shield", "bullet_time"], 46).credits).toBe(112);
});
it("未知时长、无效果、无效类型与溢出不能给出有效报价", () => {
  for (const seconds of [0,-1,NaN,Infinity,Number.MAX_VALUE]) expect(() => quoteManhuaVfxCredits(["shield"],seconds)).toThrow();
  expect(() => quoteManhuaVfxCredits([],15)).toThrow();
  expect(() => quoteManhuaVfxCredits(["unknown" as never],15)).toThrow();
});

it.each(["mirror_corridor","floating_paper","cup_fracture","fruit_stall_fracture","city_fold","prop_scene"] as const)("新增%s未获标价授权，单独或混合都不能显示零价或沿用较低价",kind=>{
 expect(MANHUA_VFX_CREDITS_PER_15_SECONDS[kind]).toBeNull();
 expect(manhuaVfxCreditLabel(kind)).toBe("待确认标价");
 expect(()=>quoteManhuaVfxCredits([kind],15)).toThrow("尚未核定标价");
 expect(()=>quoteManhuaVfxCredits(["shield",kind,"bullet_time"],46)).toThrow("尚未核定标价");
});
it("核价标签与19项原合同保持一致",()=>{
 expect(Object.values(MANHUA_VFX_CREDITS_PER_15_SECONDS).filter(v=>v!==null)).toHaveLength(19);
 expect(manhuaVfxCreditLabel("shield")).toBe("8积分/15秒");
 expect(manhuaVfxCreditLabel("motion_ghost")).toBe("16积分/15秒");
 expect(manhuaVfxCreditLabel("bullet_time")).toBe("32积分/15秒");
});
