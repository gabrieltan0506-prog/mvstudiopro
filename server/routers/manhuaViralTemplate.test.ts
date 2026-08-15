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

vi.mock("../services/manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(async () => [
    { laneZh: "爽文逆袭", items: [secretCard, noCodeCard] },
  ]),
}));
vi.mock("../services/manhuaViralTemplateCopy", () => ({
  MANHUA_VIRAL_TEMPLATE_COPY: {
    tpl_series_deadbeef0001: { featureZh: "特色文案A", introZh: "简介文案B" },
  },
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
): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "t",
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

describe("listApprovedPrivate：鉴权矩阵", () => {
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

  it("admin 角色可读全量（真名可见）", async () => {
    const caller = (await loadRouter()).createCaller(makeCtx("admin"));
    const out = await caller.listApprovedPrivate();
    expect(JSON.stringify(out)).toContain("某爆款剧真名节奏");
  });

  it("与当前账号绑定的未过期监管会话可读全量", async () => {
    const caller = (await loadRouter()).createCaller(makeCtx("user", {
      userId: 7,
      expiresAt: Date.now() + 60_000,
    }));
    const out = await caller.listApprovedPrivate();
    expect(JSON.stringify(out)).toContain("某爆款剧真名节奏");
  });
});
