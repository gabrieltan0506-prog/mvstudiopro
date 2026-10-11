import { expect, it, vi } from "vitest";
import { assertPaidSceneGenerationAccess, getPaidSceneAccess } from "./paidSceneAccess";

it("只从账号方案取会员身份，免费和普通付费会员均不产生生成授权", async () => {
  const read = vi.fn(async () => "free" as const);
  expect(await getPaidSceneAccess({ id: 7, role: "user" }, read)).toMatchObject({ canGenerate: false, reason: "membership_required" });
  expect(read).toHaveBeenCalledWith(7);
  await expect(assertPaidSceneGenerationAccess({ id: 7, role: "user" }, async () => "pro")).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("尚未开放") });
});
it("会员查询故障不放行，内部角色无须查询订阅", async () => {
  const read = vi.fn(async (): Promise<"free"> => { throw new Error("plan unavailable"); });
  await expect(getPaidSceneAccess({ id: 7, role: "user" }, read)).rejects.toThrow("plan unavailable");
  read.mockClear();
  for (const role of ["admin", "supervisor"]) expect((await assertPaidSceneGenerationAccess({ id: 7, role }, read)).canGenerate).toBe(true);
  expect(read).not.toHaveBeenCalled();
});
