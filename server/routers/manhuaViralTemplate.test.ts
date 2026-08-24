/**
 * 隐私关键路由测试（审查返工 [9]，2026-08-15）：
 * 公开面 7 字段白名单 / 私有面鉴权矩阵 / 无码卡隐藏 / 序列化零泄漏。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";

const secretCard = {
  id: "tpl_series_deadbeef0001",
  nameZh: "某爆款剧真名节奏",
  laneZh: "爽文逆袭",
  summaryZh: "内部摘要SECRET_SUMMARY",
  hook3sZh: "内部钩子SECRET_HOOK",
  beatGrid: [
    { atSec: 0, conflictZh: "冲突SECRET_BEAT", visualZh: "画面SECRET_VISUAL" },
    { atSec: 3, conflictZh: "冲突2", visualZh: "画面2" },
  ],
  scenePoolHints: ["场景SECRET_SCENE"],
  castShape: { leadDesireZh: "欲望SECRET", pressureZh: "压力SECRET" },
  densityHints: { minBodyChars: 280, minDialogueLines: 12, minLocationHits: 2 },
  sourceRefs: [{ url: "https://douyin.example/SECRET_URL", fetchedAt: "2026-08-01" }],
  status: "approved",
  publicCode: "A7F2",
  provenance: {
    proposalPolish: { provider: "SECRET_PROVIDER", model: "m", attempted: true, success: true },
  },
  privateFutureField: "SECRET_FUTURE",
} as unknown as ManhuaViralTemplateCard;

const noCodeCard = {
  ...secretCard,
  id: "tpl_series_nocode000002",
  nameZh: "无码剧真名SECRET_NOCODE",
  publicCode: undefined,
} as unknown as ManhuaViralTemplateCard;

const revisionCard = {
  ...secretCard,
  id: "tpl_revision_owner0001",
  status: "proposed",
  publicCode: undefined,
  revision: {
    parentTemplateId: secretCard.id,
    requestId: "request_owner_1234",
    model: "deepseek_v4_0813_high",
    modelName: "deepseek/deepseek-v4-pro-0813",
    reasoningEffort: "high",
    promptZh: "强化钩子。",
    changedFields: ["hook3sZh"],
    reasons: [{ field: "hook3sZh", reasonZh: "强化前三秒。" }],
    createdByUserId: 7,
    createdAt: "2026-08-17T00:00:00.000Z",
  },
} as unknown as ManhuaViralTemplateCard;

let proposalForRouter: ManhuaViralTemplateCard | null = revisionCard;

vi.mock("../services/manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(async () => [
    { laneZh: "爽文逆袭", items: [secretCard, noCodeCard] },
  ]),
  listGcsManhuaViralProposals: vi.fn(async () => [revisionCard]),
  listGcsManhuaViralApproved: vi.fn(async () => [secretCard]),
  // 生命周期判断改用严格全量（宽松版只读 80 张、失败返回 []）
  listGcsManhuaViralApprovedStrict: vi.fn(async () => [secretCard]),
  // 归档索引独立返回：恢复入口不再依赖 approved 行存在
  listArchivedManhuaViralTemplateIndex: vi.fn(async () => []),
  listArchivedManhuaViralTemplateVersions: vi.fn(async () => []),
  restoreArchivedManhuaViralTemplate: vi.fn(async () => secretCard),
  archiveApprovedManhuaViralTemplate: vi.fn(async () => secretCard),
  getGcsManhuaViralApproved: vi.fn(async () => secretCard),
  getGcsManhuaViralProposal: vi.fn(async () => proposalForRouter),
  saveManhuaViralTemplateRevisionProposal: vi.fn(async (card: ManhuaViralTemplateCard) => card),
  approveManhuaViralTemplate: vi.fn(async () => secretCard),
}));
vi.mock("../services/manhuaViralTemplateCopy", () => ({
  MANHUA_VIRAL_TEMPLATE_COPY: {
    tpl_series_deadbeef0001: { featureZh: "特色文案A", introZh: "简介文案B" },
  },
}));
vi.mock("../services/manhuaViralTemplateOptimize", () => ({
  MANHUA_VIRAL_TEMPLATE_OPTIMIZE_MODELS: [
    { id: "terra_high", labelZh: "GPT-5.6 Terra · High", reasoningEffort: "high" },
  ],
  optimizeApprovedManhuaViralTemplate: vi.fn(async () => ({
    original: secretCard,
    proposal: revisionCard,
    changedFields: ["hook3sZh"],
    reasons: [{ field: "hook3sZh", reasonZh: "强化前三秒。" }],
  })),
}));

/**
 * access-policy 在模块加载时固化 SUPERVISOR_SECRET，故涉 token 的用例必须
 * 先 stubEnv 再 resetModules 后动态导入路由（store/copy 的 vi.mock 会随重评估复用）。
 */
async function loadRouter() {
  vi.resetModules();
  const mod = await import("./manhuaViralTemplate");
  return mod.manhuaViralTemplateRouter;
}

function makeCtx(
  role: "user" | "admin" | "supervisor",
  supervisorSession?: TrpcContext["supervisorSession"],
  openId = "t",
): TrpcContext {
  return {
    user: {
      id: 7,
      openId,
      email: "t@example.com",
      name: "T",
      loginMethod: "manus",
      role,
      credits: 0,
      roleTag: "normal",
      contactWechat: null,
      contactPhone: null,
      verifyStatus: "none",
      enterpriseTrialPaid: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]>,
    supervisorSession,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  proposalForRouter = revisionCard;
});

describe("listApprovedPublic：普通用户只拿匿名功能卡", () => {
  it("七字段白名单 + 序列化零泄漏（含未来私密字段）", async () => {
    const caller = (await loadRouter()).createCaller(makeCtx("user"));
    const out = await caller.listApprovedPublic();
    expect(out.groups).toHaveLength(1);
    const items = out.groups[0]!.items;
    // 无码卡必须被隐藏（fail-closed）
    expect(items).toHaveLength(1);
    const card = items[0]!;
    expect(Object.keys(card).sort()).toEqual(
      ["beatCount", "densityLevel", "featureZh", "introZh", "laneZh", "nameZh", "publicId"].sort(),
    );
    const wire = JSON.stringify(out);
    for (const leak of [
      "tpl_series",
      "真名",
      "SECRET_SUMMARY",
      "SECRET_HOOK",
      "SECRET_BEAT",
      "SECRET_VISUAL",
      "SECRET_SCENE",
      "SECRET_URL",
      "SECRET_PROVIDER",
      "SECRET_FUTURE",
      "SECRET_NOCODE",
      "sourceRefs",
      "provenance",
    ]) {
      expect(wire).not.toContain(leak);
    }
    expect(card.publicId).toBe("mt_a7f2");
    expect(card.nameZh).toBe("爽文逆袭·爆款节奏 A7F2");
    expect(card.featureZh).toBe("特色文案A");
  });

  it("配置 HMAC 密钥后，无码卡以稳定匿名句柄公开且仍不泄漏内部字段", async () => {
    vi.stubEnv("MANHUA_TEMPLATE_PUBLIC_ID_SECRET", "template-public-test-secret");
    const caller = (await loadRouter()).createCaller(makeCtx("user"));
    const out = await caller.listApprovedPublic();
    const items = out.groups[0]!.items;
    expect(items).toHaveLength(2);
    const fallback = items.find((item) => item.publicId !== "mt_a7f2");
    expect(fallback?.publicId).toMatch(/^mt_[a-f0-9]{16}$/);
    expect(JSON.stringify(fallback)).not.toContain("tpl_series_nocode");
    expect(JSON.stringify(fallback)).not.toContain("SECRET_NOCODE");
  });
});

describe("listApprovedPrivate：owner-only 鉴权矩阵", () => {
  it("普通用户（无监管会话）必须 FORBIDDEN", async () => {
    const caller = (await loadRouter()).createCaller(makeCtx("user"));
    await expect(caller.listApprovedPrivate()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("绑定其他账号的监管会话仍 FORBIDDEN", async () => {
    const caller = (await loadRouter()).createCaller(makeCtx("user", {
      userId: 8,
      expiresAt: Date.now() + 60_000,
    }));
    await expect(caller.listApprovedPrivate()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("其他 admin/supervisor 角色也不能读取全量", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const router = await loadRouter();
    await expect(router.createCaller(makeCtx("admin", undefined, "other-admin")).listApprovedPrivate())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(router.createCaller(makeCtx("supervisor", undefined, "other-supervisor")).listApprovedPrivate())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("监管会话不能替代 owner 身份", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const caller = (await loadRouter()).createCaller(makeCtx("user", {
      userId: 7,
      expiresAt: Date.now() + 60_000,
    }, "other-user"));
    await expect(caller.listApprovedPrivate()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("OWNER_OPEN_ID 本人可读完整模板和原始 GCS 清单", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const caller = (await loadRouter()).createCaller(makeCtx("user", undefined, "owner-open-id"));
    expect(JSON.stringify(await caller.listApprovedPrivate())).toContain("某爆款剧真名节奏");
    expect(JSON.stringify(await caller.listApprovedGcsOnly())).toContain("某爆款剧真名节奏");
  });
});

describe("生命周期三路由：owner-only 鉴权矩阵", () => {
  /**
   * 换代体检会列出全库正式卡（含内部字段），归档恢复能改动正式库——
   * 这三条比只读列表更敏感，权限必须逐个钉死，不能只靠 UI 不显示入口。
   */
  const lifecycleCalls = (caller: {
    reviewTemplateGenerations: () => Promise<unknown>;
    listArchivedVersions: (i: { id: string }) => Promise<unknown>;
    restoreArchived: (i: { id: string; generation: string; confirmRestore: true }) => Promise<unknown>;
  }) => [
    () => caller.reviewTemplateGenerations(),
    () => caller.listArchivedVersions({ id: "tpl_series_abc" }),
    () =>
      caller.restoreArchived({ id: "tpl_series_abc", generation: "77", confirmRestore: true }),
  ];

  it("普通用户（无监管会话）三条全 FORBIDDEN", async () => {
    const caller = (await loadRouter()).createCaller(makeCtx("user")) as never;
    for (const call of lifecycleCalls(caller)) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("其他 admin/supervisor 角色也不能调用", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const router = await loadRouter();
    for (const role of ["admin", "supervisor"] as const) {
      const caller = router.createCaller(makeCtx(role, undefined, `other-${role}`)) as never;
      for (const call of lifecycleCalls(caller)) {
        await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });

  it("监管会话不能替代 owner 身份", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const caller = (await loadRouter()).createCaller(
      makeCtx("user", { userId: 7, expiresAt: Date.now() + 60_000 }, "other-user"),
    ) as never;
    for (const call of lifecycleCalls(caller)) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("owner 本人可以调用换代体检（拿到的是结论而不是权限错）", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const caller = (await loadRouter()).createCaller(
      makeCtx("user", undefined, "owner-open-id"),
    );
    const out = await caller.reviewTemplateGenerations();
    expect(out).toHaveProperty("items");
  });

  it("非数字 generation 在路由层就被拒（owner 也不例外）", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const caller = (await loadRouter()).createCaller(
      makeCtx("user", undefined, "owner-open-id"),
    );
    await expect(
      caller.restoreArchived({
        id: "tpl_series_abc",
        // 路径穿越型输入：长度校验放得过去，数字正则放不过去
        generation: "../approved/tpl_x" as never,
        confirmRestore: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("owner 模板查看与优化", () => {
  it("只有 OWNER_OPEN_ID 本人获得查看能力，admin/supervisor 角色不能替代", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const router = await loadRouter();
    const owner = router.createCaller(makeCtx("user", undefined, "owner-open-id"));
    const otherAdmin = router.createCaller(makeCtx("admin", undefined, "other-admin"));
    const ownerCaps = await owner.getOwnerOptimizeCapabilities();
    expect(ownerCaps.allowed).toBe(true);
    expect(ownerCaps.models).toEqual([
      { id: "terra_high", labelZh: "GPT-5.6 Terra · High", reasoningEffort: "high" },
    ]);
    expect(await otherAdmin.getOwnerOptimizeCapabilities()).toEqual({ allowed: false, models: [] });
    await expect(otherAdmin.getApprovedOwnerDetail({ id: secretCard.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await owner.getApprovedOwnerDetail({ id: secretCard.id })).card.nameZh)
      .toContain("真名");
  });

  it("owner 优化成功后返回真实变更和待审修订；其他 admin 不能调用", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const router = await loadRouter();
    const input = {
      id: secretCard.id,
      model: "terra_high" as const,
      promptZh: "强化前三秒。",
      requestId: "request_owner_1234",
      confirmPaidCall: true as const,
    };
    const owner = router.createCaller(makeCtx("user", undefined, "owner-open-id"));
    const result = await owner.optimizeApproved(input);
    expect(result).toMatchObject({
      ok: true,
      changedFields: ["hook3sZh"],
      proposal: { id: "tpl_revision_owner0001", status: "proposed" },
    });
    const otherAdmin = router.createCaller(makeCtx("admin", undefined, "other-admin"));
    await expect(otherAdmin.optimizeApproved(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("非 owner 的监管账号看不到优化修订，也不能批准替换", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const router = await loadRouter();
    const otherAdmin = router.createCaller(makeCtx("admin", undefined, "other-admin"));
    expect((await otherAdmin.listProposals()).items).toEqual([]);
    await expect(otherAdmin.approve({
      id: revisionCard.id,
      confirmApprove: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(otherAdmin.approve({
      card: { id: revisionCard.id },
      confirmApprove: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("首次 GCS 读取缺失时，修订 id 仍对非 owner fail closed", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    proposalForRouter = null;
    const otherAdmin = (await loadRouter()).createCaller(
      makeCtx("admin", undefined, "other-admin"),
    );
    await expect(otherAdmin.approve({
      id: "tpl_revision_temporarily_missing",
      confirmApprove: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner 即使没有监管角色，也能查看并批准自己的优化修订", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-open-id");
    const owner = (await loadRouter()).createCaller(makeCtx("user", undefined, "owner-open-id"));
    const proposals = (await owner.listProposals()).items;
    expect(proposals).toMatchObject([
      { id: revisionCard.id, revisionOf: secretCard.id },
    ]);
    // 审批可见性：结构字段必须下发，来源 URL 必须不下发。
    expect(proposals[0]).toMatchObject({
      beatGrid: secretCard.beatGrid,
      scenePoolHints: secretCard.scenePoolHints,
      castShape: secretCard.castShape,
      densityHints: secretCard.densityHints,
      sourceRefCount: 1,
    });
    expect(proposals[0]).not.toHaveProperty("sourceRefs");
    expect(JSON.stringify(proposals)).not.toContain("SECRET_URL");

    await expect(owner.approve({
      id: revisionCard.id,
      confirmApprove: true,
    })).resolves.toMatchObject({ ok: true });
  });
});
