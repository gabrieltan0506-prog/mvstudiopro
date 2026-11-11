import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const svc = vi.hoisted(() => ({
  getManhuaTemplateLapianSegmentPrompt: vi.fn(async () => ({ status: "absent" })),
  getManhuaTemplateLapianGenes: vi.fn(async () => ({ status: "absent" })),
  getManhuaTemplateLapianSegmentClip: vi.fn(async () => ({ available: false, reasonZh: "x", startSec: 0, endSec: 1 })),
}));
vi.mock("../services/manhuaTemplateLapianService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/manhuaTemplateLapianService")>()),
  ...svc,
}));

function makeCtx(role: "user" | "admin" | "supervisor", openId: string): TrpcContext {
  return {
    user: {
      id: 7, openId, email: "t@example.com", name: "T", loginMethod: "manus", role, credits: 0, roleTag: "normal",
      contactWechat: null, contactPhone: null, verifyStatus: "none", enterpriseTrialPaid: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

const load = async () => (await import("./manhuaTemplateLapian")).manhuaTemplateLapianRouter;
const id = "tpl_native_fixture29_ep029";

afterEach(() => {
  vi.unstubAllEnvs();
  Object.values(svc).forEach(fn => fn.mockClear());
});

describe("模板学习拉片视图接口权限", () => {
  it("非站长（含普通管理员、监管）一律 FORBIDDEN，且不触达服务（不调模型、不裁切）", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const router = await load();
    for (const ctx of [makeCtx("user", "u"), makeCtx("admin", "other-admin"), makeCtx("supervisor", "other-sup")]) {
      const caller = router.createCaller(ctx);
      await expect(caller.segmentPrompt({ templateId: id, segmentIndex: 0, generate: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.genes({ templateId: id, generate: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.segmentClip({ templateId: id, segmentIndex: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(svc.getManhuaTemplateLapianSegmentPrompt).not.toHaveBeenCalled();
    expect(svc.getManhuaTemplateLapianGenes).not.toHaveBeenCalled();
    expect(svc.getManhuaTemplateLapianSegmentClip).not.toHaveBeenCalled();
  });

  it("未配置站长时任何人都不可用", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "");
    const caller = (await load()).createCaller(makeCtx("admin", "anyone"));
    await expect(caller.genes({ templateId: id, generate: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("站长可用；业务错误映射为对应 TRPC 错误码", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const caller = (await load()).createCaller(makeCtx("admin", "owner-open-id"));
    await expect(caller.segmentPrompt({ templateId: id, segmentIndex: 2, generate: false })).resolves.toMatchObject({ status: "absent" });
    expect(svc.getManhuaTemplateLapianSegmentPrompt).toHaveBeenCalledWith({ templateId: id, segmentIndex: 2, generate: false });
    const { ManhuaTemplateLapianError } = await import("../services/manhuaTemplateLapianService");
    svc.getManhuaTemplateLapianGenes.mockRejectedValueOnce(new ManhuaTemplateLapianError("NOT_FOUND", "模板不存在"));
    await expect(caller.genes({ templateId: id, generate: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.segmentClip({ templateId: "../evil", segmentIndex: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
