import { expect, it } from "vitest";
import { MANHUA_VFX_KINDS } from "./manhuaVfx";
import { MANHUA_VFX_CREDITS_PER_15_SECONDS, quoteManhuaVfxCredits } from "./manhuaVfxPricing";
it.each([[.01,8],[15,8],[15.001,16],[30,16],[30.001,20],[44.999,20],[45,24],[45.001,28],[59.999,28],[60,32],[75,40]])("%s秒按已确认整段及半价尾段计为%s积分", (seconds, credits) => {
  expect(quoteManhuaVfxCredits(["shield"], seconds).credits).toBe(credits);
});
it("19种效果都有逐项价格，多层只取最高单价，不重复累加", () => {
  expect(Object.keys(MANHUA_VFX_CREDITS_PER_15_SECONDS).sort()).toEqual([...MANHUA_VFX_KINDS].sort());
  expect(quoteManhuaVfxCredits(["shield", "shield", "motion_ghost"], 31)).toEqual({ unitCredits: 16, units: 2.5, credits: 40 });
  expect(quoteManhuaVfxCredits(["shield", "bullet_time"], 46).credits).toBe(112);
});
it("未知时长、无效果、无效类型与溢出不能给出有效报价", () => {
  for (const seconds of [0,-1,NaN,Infinity,Number.MAX_VALUE]) expect(() => quoteManhuaVfxCredits(["shield"],seconds)).toThrow();
  expect(() => quoteManhuaVfxCredits([],15)).toThrow();
  expect(() => quoteManhuaVfxCredits(["unknown" as never],15)).toThrow();
});
