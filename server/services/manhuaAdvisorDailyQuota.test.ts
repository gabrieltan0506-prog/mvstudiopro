import { describe, expect, it } from "vitest";
import { advisorQuotaDay, quotaUsed } from "./manhuaAdvisorDailyQuota";
describe("顾问每日额度边界", () => {
  it("北京时间零点切日，跨 UTC 日期和服务器时区保持一致", () => {
    expect(advisorQuotaDay(new Date("2026-09-29T15:59:59.999Z"))).toMatchObject({ day: "2026-09-29", resetsAt: "2026-09-29T16:00:00.000Z" });
    expect(advisorQuotaDay(new Date("2026-09-29T16:00:00.000Z"))).toMatchObject({ day: "2026-09-30", resetsAt: "2026-09-30T16:00:00.000Z" });
  });
  it("在途请求占位，失败释放不占用；异常记录不能变成免费", () => {
    expect(quotaUsed({ seed: 2, claims: { a: "reserved", b: "released" } })).toBe(3);
    expect(() => quotaUsed({ seed: -1, claims: {} })).toThrow();
    expect(() => quotaUsed({ seed: 0, claims: { a: "unknown" as any } })).toThrow();
  });
});
