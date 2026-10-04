import { describe, expect, it, vi } from "vitest";
const stat = vi.fn();
vi.mock("./gcs", () => ({ statGcsObjectVersion: (...args: unknown[]) => stat(...args) }));
vi.mock("./manhuaCloudDraftGcsStore", () => ({ manhuaCloudDraftGcsUri: (userId: number, projectId: string) => `gs://test/user-${userId}/${projectId}` }));
import { advisorProjectQuotaId, assertAdvisorProject } from "./manhuaAdvisorProjectQuota";

describe("每作品额度账户隔离", () => {
  it("旧工作区只有一个桶；新作品和其他账户互不占用", () => {
    expect(advisorProjectQuotaId(7)).toBe(advisorProjectQuotaId(7, undefined));
    expect(new Set([advisorProjectQuotaId(7), advisorProjectQuotaId(7, "a"), advisorProjectQuotaId(7, "b"), advisorProjectQuotaId(8, "a")]).size).toBe(4);
  });
  it("作品存在校验使用登录用户路径，不接收另一用户身份", async () => {
    stat.mockResolvedValueOnce({ generation: "1" });
    await assertAdvisorProject(7, "a");
    expect(stat).toHaveBeenCalledWith({ gcsUri: "gs://test/user-7/a" });
    stat.mockRejectedValueOnce(new Error("404"));
    await expect(assertAdvisorProject(8, "a")).rejects.toThrow("本次未扣费");
  });
});
