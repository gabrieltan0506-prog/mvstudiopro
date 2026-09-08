import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({ db: vi.fn(), select: vi.fn(), from: vi.fn(), where: vi.fn(), limit: vi.fn() }));
vi.mock("./db", () => ({ getDb: m.db }));
import { readCreditsChargeByKey } from "./credits";
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockResolvedValue({ select: m.select }); m.select.mockReturnValue({ from: m.from }); m.from.mockReturnValue({ where: m.where }); m.where.mockReturnValue({ limit: m.limit });
  m.limit.mockResolvedValue([]);
});
describe("读取已扣账单不触碰余额", () => {
  it("按账号和完整幂等key精确查询，原账不存在返回null", async () => {
    const key = `knowledgeCardReading/7/${"a".repeat(64)}`;
    expect(await readCreditsChargeByKey(7, key)).toBeNull();
    const query = new PgDialect().sqlToQuery(m.where.mock.calls[0]![0]);
    expect(query.params).toEqual([7, key]);
    expect(query.sql).toContain('"userId"'); expect(query.sql).toContain('"chargeKey"');
    expect(m.limit).toHaveBeenCalledWith(1);
  });
  it.each([null, JSON.stringify({ source: "team", teamId: 12, memberId: 34 })])("恢复原金额及原个人/团队来源%s", async metadata => {
    m.limit.mockResolvedValue([{ creditsCost: 50, metadata }]);
    expect(await readCreditsChargeByKey(7, "known-charge")).toEqual(metadata ? { cost: 50, source: "team", teamId: 12, teamMemberId: 34 } : { cost: 50, source: "personal" });
  });
  it("非法查询身份在数据库之前拒绝，断库与查询失败均向上抛出", async () => {
    await expect(readCreditsChargeByKey(0, "known-charge")).rejects.toThrow("身份");
    await expect(readCreditsChargeByKey(7, "x".repeat(121))).rejects.toThrow("身份");
    expect(m.db).not.toHaveBeenCalled();
    m.db.mockResolvedValueOnce(null);
    await expect(readCreditsChargeByKey(7, "known-charge")).rejects.toThrow("Database");
    m.limit.mockRejectedValueOnce(new Error("数据库失败"));
    await expect(readCreditsChargeByKey(7, "known-charge")).rejects.toThrow("数据库失败");
  });
});
