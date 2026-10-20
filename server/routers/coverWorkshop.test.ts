import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  prepare: vi.fn(),
  submit: vi.fn(),
  get: vi.fn(),
  recover: vi.fn(),
}));
vi.mock("../services/coverWorkshop", () => ({
  listCovers: f.list,
  prepareCover: f.prepare,
  submitCover: f.submit,
  getCover: f.get,
  recoverCover: f.recover,
}));
import { coverWorkshopRouter } from "./coverWorkshop";
it("所有封面入口要求登录，历史查询账号范围防止切号缓存泄漏", async () => {
  const guest = coverWorkshopRouter.createCaller({ user: null } as any);
  await expect(guest.list({ accountId: "1" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  const user = coverWorkshopRouter.createCaller({ user: { id: 1 } } as any);
  await expect(user.list({ accountId: "2" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(f.list).not.toHaveBeenCalled();
  expect(await user.list({ accountId: "1" })).toEqual([]);
  expect(f.list).toHaveBeenCalledWith("1");
  for (const name of ["get", "submit", "recover"] as const)
    await expect(
      (guest[name] as any)({
        id: "11111111-1111-4111-8111-111111111111",
        fingerprint: "a".repeat(64),
        index: 0,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
