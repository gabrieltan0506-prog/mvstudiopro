/**
 * 归档查看与恢复的**存储层行为**。
 *
 * 立此文件的由头：这条链原来把「读不动」和「没有」压成同一个结果——
 * 列举失败 catch 成 []、单张读失败 continue 掉，页面最后显示「还没有归档版本」。
 * 用户据此以为旧版没了，实际只是 GCS 抖了一下。归档件是花钱学来的，
 * 一部 58 分钟合辑学一次约 $1.075，不能靠「看起来没有」下结论。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";

/**
 * 批准/下架/恢复共用一把 GCS 生命周期锁，所以 mock 必须让锁能真的拿到与释放：
 * 锁对象走 `uploadBufferToGcsIfAbsent` 建、`downloadGcsObjectVersioned` 回读比对 token。
 * 不 mock 它，所有写操作都会卡在「另一项操作正在处理」。
 */
const LOCK_OBJECT = "manhua-template-learn/locks/approved-lifecycle.json";
const lockState = vi.hoisted(() => ({
  body: Buffer.from("{}"),
  held: false,
  generation: "1",
})) as { body: Buffer; held: boolean; generation: string };

const gcs = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  downloadVersioned: vi.fn(),
  createIfAbsent: vi.fn(),
  /** 恢复成功后同步 proposals/ 审计副本走这条，要能断言内容 */
  upload: vi.fn(async (_params: { objectName: string; buffer: Buffer; contentType: string }) => ({})),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  listGcsObjectNamesByPrefix: gcs.list,
  downloadGcsObject: gcs.download,
  uploadBufferToGcs: gcs.upload,
  uploadBufferToGcsIfAbsent: async (p: { objectName: string; buffer: Buffer }) => {
    if (p.objectName === LOCK_OBJECT) {
      if (lockState.held) return { created: false };
      lockState.held = true;
      lockState.body = p.buffer;
      return { created: true };
    }
    return gcs.createIfAbsent(p);
  },
  downloadGcsObjectVersioned: gcs.downloadVersioned,
  deleteGcsObject: async ({
    objectName,
    ifGenerationMatch,
  }: { objectName: string; ifGenerationMatch?: string }) => {
    if (objectName !== LOCK_OBJECT) return;
    // 条件删除：generation 不匹配就拒 —— 防旧持有者删掉被接管后重建的新锁
    if (ifGenerationMatch && ifGenerationMatch !== lockState.generation) {
      throw new Error("gcs_delete_generation_conflict");
    }
    lockState.held = false;
  },
}));

import {
  MANHUA_TEMPLATE_LOCK_TTL_MS,
  acquireManhuaTemplateLifecycleLock,
  isLifecycleLeaseExpired,
  manhuaTemplateLifecycleClock,
  archiveApprovedManhuaViralTemplate,
  compareGenerationDesc,
  listArchivedManhuaViralTemplateIndex,
  listArchivedManhuaViralTemplateVersions,
  restoreArchivedManhuaViralTemplate,
  MANHUA_VIRAL_APPROVED_PREFIX,
  MANHUA_VIRAL_ARCHIVE_PREFIX,
} from "./manhuaViralTemplateStore";

const ID = "tpl_series_wanyao";

/** 字段照真实解析器的必填项造，缺一项就 parse 不出来（照印象写会全红） */
const cardOf = (over: Record<string, unknown> = {}) => ({
  id: ID,
  nameZh: "样例",
  laneZh: "古言种田",
  summaryZh: "摘要。",
  hook3sZh: "钩子。",
  status: "approved",
  publicCode: "AB12",
  beatGrid: [{ atSec: 0, conflictZh: "c", visualZh: "v" }],
  scenePoolHints: ["场景"],
  castShape: { leadDesireZh: "欲望", pressureZh: "压力" },
  densityHints: { minBodyChars: 200, minDialogueLines: 4, minLocationHits: 1 },
  sourceRefs: [],
  updatedAt: "2026-08-20T00:00:00.000Z",
  ...over,
});

const obj = (generation: string) => `${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/${generation}.json`;

/** 让每个归档对象返回自己的卡（可按 generation 定制） */
const seedArchive = (
  generations: string[],
  make: (g: string) => Record<string, unknown> = () => cardOf(),
) => {
  gcs.list.mockResolvedValue(generations.map(obj));
  gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
    const g = String(gcsUri).match(/\/(\d+)\.json$/)?.[1] || "";
    return { buffer: Buffer.from(JSON.stringify(make(g)), "utf8") };
  });
};

beforeEach(() => {
  lockState.held = false;
  lockState.generation = "1";
  gcs.upload.mockClear();
  gcs.list.mockReset();
  gcs.download.mockReset();
  gcs.downloadVersioned.mockReset();
  gcs.createIfAbsent.mockReset();
  gcs.downloadVersioned.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
    if (String(gcsUri).endsWith(LOCK_OBJECT)) {
      return { buffer: lockState.body, generation: lockState.generation };
    }
    return {
      ...(await gcs.download({ gcsUri })),
      generation: "7",
    };
  });
});

describe("归档列表：读不动必须 fail-closed", () => {
  it("🔴 GCS 列举失败时抛错，不返回空数组", async () => {
    gcs.list.mockRejectedValue(new Error("gcs_list_failed:503"));
    await expect(listArchivedManhuaViralTemplateVersions(ID)).rejects.toThrow();
  });

  it("🔴 单个归档 JSON 坏掉时整次查询失败，不静默跳过", async () => {
    gcs.list.mockResolvedValue([obj("1"), obj("2")]);
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) =>
      String(gcsUri).endsWith("2.json")
        ? { buffer: Buffer.from("{ 这不是 JSON", "utf8") }
        : { buffer: Buffer.from(JSON.stringify(cardOf()), "utf8") },
    );
    await expect(listArchivedManhuaViralTemplateVersions(ID)).rejects.toThrow(/JSON/);
  });

  it("🔴 归档对象里的 card.id 与目录 id 不一致时拒绝列出", async () => {
    seedArchive(["1"], () => cardOf({ id: "tpl_series_bieder" }));
    await expect(listArchivedManhuaViralTemplateVersions(ID)).rejects.toThrow(/不一致/);
  });

  it("非法模板 id 直接拒，不去拼对象路径", async () => {
    await expect(listArchivedManhuaViralTemplateVersions("../../etc")).rejects.toThrow(
      /id 格式无效/,
    );
    expect(gcs.list).not.toHaveBeenCalled();
  });

  it("目录下的非数字文件名被忽略，不当成版本", async () => {
    gcs.list.mockResolvedValue([obj("1"), `${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/latest.json`]);
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf()), "utf8"),
    });
    const rows = await listArchivedManhuaViralTemplateVersions(ID);
    expect(rows.map((r) => r.generation)).toEqual(["1"]);
  });
});

describe("归档列表：必须是最新 N 个，不是字典序前 N 个", () => {
  it("🔴 30 个版本取 20 个时，返回的是真正最新的 20 个", async () => {
    // generation 1..30，updatedAt 随之递增
    const gens = Array.from({ length: 30 }, (_, i) => String(i + 1));
    seedArchive(gens, (g) =>
      cardOf({ updatedAt: `2026-08-${String(Number(g)).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const rows = await listArchivedManhuaViralTemplateVersions(ID, 20);
    expect(rows).toHaveLength(20);
    // 最新的排最前
    expect(rows[0]!.generation).toBe("30");
    // 最老的那批不该出现
    expect(rows.map((r) => r.generation)).not.toContain("1");
  });

  it("列举请求一次拉满，不把 maxResults 当列举上限（否则先截断再排序）", async () => {
    seedArchive(["1"]);
    await listArchivedManhuaViralTemplateVersions(ID, 5);
    expect(gcs.list).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 1000 }),
    );
  });
});

describe("恢复：身份与状态都要校验", () => {
  /**
   * 恢复现在会在锁内读**完整正式库**做 publicCode 查重
   * （归档期间旧码可能被别人占走，沿用会产生两张同码卡）。
   * 所以列举要按前缀分流：approved/ 给查重，archive/ 给版本列表。
   */
  const seedApproved = (cards: Array<Record<string, unknown>> = []) => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? cards.map((c) => `manhua-template-learn/approved/${c.id}.json`)
        : [],
    );
    const byName = new Map(
      cards.map((c) => [`manhua-template-learn/approved/${c.id}.json`, c]),
    );
    return byName;
  };

  it("🔴 非数字 generation 在存储层就被拒（不只靠路由的 zod）", async () => {
    await expect(
      restoreArchivedManhuaViralTemplate({ id: ID, generation: "../approved/tpl_x" }),
    ).rejects.toThrow(/版本号格式无效/);
    expect(gcs.download).not.toHaveBeenCalled();
  });

  it("🔴 归档卡的 id 与目标不一致时停止恢复，不写任何对象", async () => {
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ id: "tpl_series_bieder" })), "utf8"),
    });
    await expect(
      restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" }),
    ).rejects.toThrow(/不一致/);
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
  });

  it("归档卡状态不合法时停止恢复", async () => {
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ status: "proposed" })), "utf8"),
    });
    await expect(
      restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" }),
    ).rejects.toThrow(/状态无效/);
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
  });

  it("🔴 已有同 id 正式卡时明确冲突，且不覆盖", async () => {
    seedApproved();
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf()), "utf8"),
    });
    gcs.createIfAbsent.mockResolvedValue({ created: false });
    await expect(
      restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" }),
    ).rejects.toThrow(/先下架现役版本/);
  });

  it("正常恢复：状态转 approved、时间戳刷新，走条件创建", async () => {
    seedApproved();
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ status: "rejected" })), "utf8"),
    });
    gcs.createIfAbsent.mockResolvedValue({ created: true });
    const restored = await restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" });
    expect(restored.id).toBe(ID);
    expect(restored.status).toBe("approved");
    expect(gcs.createIfAbsent).toHaveBeenCalledTimes(1);
  });
});

describe("generation 必须按**数值**排序（字典序会把 9 排在 10 前面）", () => {
  it("compareGenerationDesc：10 排在 9 前面", () => {
    expect(compareGenerationDesc("9", "10")).toBeGreaterThan(0);
    expect(compareGenerationDesc("10", "9")).toBeLessThan(0);
    expect(compareGenerationDesc("10", "10")).toBe(0);
  });

  it("🔴 updatedAt 相同时，9 与 10 的返回顺序必须是 10、9", async () => {
    gcs.list.mockResolvedValue([obj("9"), obj("10")]);
    gcs.download.mockImplementation(async () => ({
      buffer: Buffer.from(JSON.stringify(cardOf({ updatedAt: "2026-08-20T00:00:00.000Z" })), "utf8"),
    }));
    const rows = await listArchivedManhuaViralTemplateVersions(ID);
    expect(rows.map((r) => r.generation)).toEqual(["10", "9"]);
  });

  it("超长 generation 用 BigInt 比，不溢出", () => {
    expect(compareGenerationDesc("999999999999999999999", "1000000000000000000000")).toBeGreaterThan(0);
  });
});

describe("严格全量列表：列不全就停手（fail-closed）", () => {
  it("🔴 达到硬上限时抛错，不按不完整列表做生命周期判断", async () => {
    const { listGcsManhuaViralApprovedStrict } = await import("./manhuaViralTemplateStore");
    // 造满 1000 条：无法证明已经列全
    gcs.list.mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => `manhua-template-learn/approved/tpl_series_x${i}.json`),
    );
    await expect(listGcsManhuaViralApprovedStrict()).rejects.toThrow(/无法确认列表完整/);
  });

  it("单卡读不动时整次抛错，不静默跳过", async () => {
    const { listGcsManhuaViralApprovedStrict } = await import("./manhuaViralTemplateStore");
    gcs.list.mockResolvedValue(["manhua-template-learn/approved/tpl_series_a.json"]);
    gcs.download.mockRejectedValue(new Error("gcs_download_failed:503"));
    await expect(listGcsManhuaViralApprovedStrict()).rejects.toThrow();
  });
});

describe("归档索引：approved 为空也要能找回（终审第七条 1）", () => {
  it("🔴 正式库一张不剩，archive/ 里的模板仍列得出来 —— 否则下架即不可逆", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/")
        ? [`${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/7.json`]
        : [], // approved/ 空
    );
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf()), "utf8"),
    });
    const rows = await listArchivedManhuaViralTemplateIndex();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(ID);
    expect(rows[0]!.beatCount).toBeGreaterThan(0);
  });

  it("🔴 同一 id 多版本时按 **card.updatedAt** 选最新，不是比文件名数字", async () => {
    // 归档文件名有两种来源：GCS generation 与修订批准的 YYYYMMDDHHmmssSSS 时间戳，
    // 不在同一数值空间。这里故意让「文件名大的那个反而更旧」
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/")
        ? [`${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/9.json`,
           `${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/10.json`]
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: Buffer.from(
        JSON.stringify(
          cardOf({
            nameZh: String(gcsUri).endsWith("9.json") ? "新版" : "旧版",
            updatedAt: String(gcsUri).endsWith("9.json")
              ? "2026-08-24T00:00:00.000Z"
              : "2026-08-01T00:00:00.000Z",
          }),
        ),
        "utf8",
      ),
    }));
    const rows = await listArchivedManhuaViralTemplateIndex();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nameZh).toBe("新版");
  });

  it("updatedAt 相同时才退回按 generation 数值比（10 胜 9）", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/")
        ? [`${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/9.json`,
           `${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/10.json`]
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: Buffer.from(
        JSON.stringify(
          cardOf({
            nameZh: String(gcsUri).endsWith("10.json") ? "十" : "九",
            updatedAt: "2026-08-20T00:00:00.000Z",
          }),
        ),
        "utf8",
      ),
    }));
    const rows = await listArchivedManhuaViralTemplateIndex();
    expect(rows[0]!.nameZh).toBe("十");
  });

  it("🔴 归档卡 status=proposed 时明确拒绝", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/") ? [`${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/7.json`] : [],
    );
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ status: "proposed" })), "utf8"),
    });
    await expect(listArchivedManhuaViralTemplateIndex()).rejects.toThrow(/状态无效/);
  });

  it("归档读取失败整次抛错，不返回空列表", async () => {
    gcs.list.mockResolvedValue([`${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/7.json`]);
    gcs.download.mockRejectedValue(new Error("gcs_download_failed:503"));
    await expect(listArchivedManhuaViralTemplateIndex()).rejects.toThrow();
  });
});

describe("下架的安全门在 store 内部（终审第七条 2/3/4）", () => {
  it("🔴 严格列表里找不到目标时明确拒绝，不继续下架", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? ["manhua-template-learn/approved/tpl_series_other.json"]
        : [],
    );
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ id: "tpl_series_other" })), "utf8"),
    });
    await expect(archiveApprovedManhuaViralTemplate(ID)).rejects.toThrow(
      /无法在完整正式库中确认/,
    );
  });

  it("🔴 严格列举失败时直接抛，不进入归档流程", async () => {
    gcs.list.mockRejectedValue(new Error("gcs_list_failed:503"));
    await expect(archiveApprovedManhuaViralTemplate(ID)).rejects.toThrow();
    // 没有写过任何归档对象
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
  });

  it("🔴 同赛道只剩一张时拒绝下架（门在 store 内，不靠路由）", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/") ? [`manhua-template-learn/approved/${ID}.json`] : [],
    );
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf()), "utf8"),
    });
    await expect(archiveApprovedManhuaViralTemplate(ID)).rejects.toThrow(/只剩这一张/);
  });

  it("🔴 并发：第二个请求抢不到生命周期锁，不会同时通过「最后一张」这道门", async () => {
    const release = await acquireManhuaTemplateLifecycleLock();
    try {
      await expect(archiveApprovedManhuaViralTemplate(ID)).rejects.toThrow(
        /正在处理，请稍后重试/,
      );
    } finally {
      await release();
    }
  });
});

describe("恢复时的 publicCode 冲突与审计副本（终审第七条 6/7）", () => {
  const seedApprovedWithCode = (code: string) => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? ["manhua-template-learn/approved/tpl_series_other.json"]
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) =>
      String(gcsUri).includes("tpl_series_other")
        ? {
            buffer: Buffer.from(
              JSON.stringify(cardOf({ id: "tpl_series_other", publicCode: code })),
              "utf8",
            ),
          }
        : { buffer: Buffer.from(JSON.stringify(cardOf({ publicCode: code })), "utf8") },
    );
  };

  it("🔴 旧码已被别的模板占用时，恢复要现铸一个新码", async () => {
    seedApprovedWithCode("AB12");
    gcs.createIfAbsent.mockResolvedValue({ created: true });
    const restored = await restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" });
    expect(restored.publicCode).toBeTruthy();
    expect(restored.publicCode).not.toBe("AB12");
  });

  it("旧码没被占用时沿用，不无谓换码（公开句柄要稳定）", async () => {
    gcs.list.mockImplementation(async () => []);
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ publicCode: "CD34" })), "utf8"),
    });
    gcs.createIfAbsent.mockResolvedValue({ created: true });
    const restored = await restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" });
    expect(restored.publicCode).toBe("CD34");
  });
});

describe("恢复成功后同步 proposals 审计副本（终审第七条 7）", () => {
  it("🔴 审计副本内容与正式卡一致：同 id、同码、status=approved", async () => {
    gcs.list.mockImplementation(async () => []);
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf({ publicCode: "EF56" })), "utf8"),
    });
    gcs.createIfAbsent.mockResolvedValue({ created: true });
    const restored = await restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" });

    const calls = gcs.upload.mock.calls as unknown as Array<
      [{ objectName: string; buffer: Buffer }]
    >;
    const call = calls.at(-1)?.[0];
    expect(call?.objectName).toBe(`manhua-template-learn/proposals/${ID}.json`);
    const synced = JSON.parse(String(call?.buffer)) as Record<string, unknown>;
    expect(synced.id).toBe(ID);
    expect(synced.status).toBe("approved");
    expect(synced.publicCode).toBe(restored.publicCode);
  });

  it("审计副本同步失败只记日志，**不把已成功的恢复谎报成失败**", async () => {
    gcs.list.mockImplementation(async () => []);
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf()), "utf8"),
    });
    gcs.createIfAbsent.mockResolvedValue({ created: true });
    gcs.upload.mockRejectedValueOnce(new Error("gcs_upload_failed:503"));
    // 正式库已经写成功了；这里再抛错会让用户重试，而重试会撞「同名正式模板已在库中」
    await expect(
      restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" }),
    ).resolves.toMatchObject({ id: ID, status: "approved" });
  });
});

describe("生命周期租约：不会因为一次失败而永久停摆（终审第四组）", () => {
  const realNow = manhuaTemplateLifecycleClock.now;
  afterEach(() => {
    manhuaTemplateLifecycleClock.now = realNow;
  });

  it("租约过期判据：兼容旧 createdAt；完全读不出时间才按未过期处理", () => {
    const now = 1_000_000;
    expect(isLifecycleLeaseExpired(null, now)).toBe(false);
    expect(isLifecycleLeaseExpired({}, now)).toBe(false);
    expect(isLifecycleLeaseExpired({ expiresAt: "not-a-date" }, now)).toBe(false);
    expect(isLifecycleLeaseExpired({ expiresAt: new Date(now + 1).toISOString() }, now)).toBe(false);
    expect(isLifecycleLeaseExpired({ expiresAt: new Date(now).toISOString() }, now)).toBe(true);
    expect(isLifecycleLeaseExpired({
      createdAt: new Date(now - MANHUA_TEMPLATE_LOCK_TTL_MS - 1).toISOString(),
    }, now)).toBe(true);
    expect(isLifecycleLeaseExpired({
      createdAt: new Date(now - MANHUA_TEMPLATE_LOCK_TTL_MS + 1).toISOString(),
    }, now)).toBe(false);
  });

  it("🔴 活着的租约挡住第二个操作", async () => {
    const release = await acquireManhuaTemplateLifecycleLock();
    try {
      await expect(acquireManhuaTemplateLifecycleLock()).rejects.toThrow(/正在处理/);
    } finally {
      await release();
    }
  });

  it("🔴 过期的租约可以被接管（用注入时钟，不真等十分钟）", async () => {
    // 先占住，然后故意不释放 —— 模拟持有者崩溃
    await acquireManhuaTemplateLifecycleLock();
    manhuaTemplateLifecycleClock.now = () => realNow() + MANHUA_TEMPLATE_LOCK_TTL_MS + 1_000;
    const release = await acquireManhuaTemplateLifecycleLock();
    expect(typeof release).toBe("function");
    await release();
  });

  it("🔴 上一版只有 createdAt 的遗留锁到期后也能被接管", async () => {
    const now = realNow();
    lockState.held = true;
    lockState.body = Buffer.from(JSON.stringify({
      token: "legacy-token",
      createdAt: new Date(now - MANHUA_TEMPLATE_LOCK_TTL_MS - 1_000).toISOString(),
    }));
    manhuaTemplateLifecycleClock.now = () => now;

    const release = await acquireManhuaTemplateLifecycleLock();
    expect(typeof release).toBe("function");
    await release();
  });

  it("🔴 release 失败后，到期仍可重新取得 —— 这正是加 expiresAt 的目的", async () => {
    const release = await acquireManhuaTemplateLifecycleLock();
    // 模拟释放时网络抖动：调用方 catch 掉了错误，锁留在 GCS
    await release().catch(() => {});
    lockState.held = true; // 锁对象仍在
    manhuaTemplateLifecycleClock.now = () => realNow() + MANHUA_TEMPLATE_LOCK_TTL_MS + 1_000;
    const again = await acquireManhuaTemplateLifecycleLock();
    expect(typeof again).toBe("function");
    await again();
  });

  it("🔴 旧持有者不能删掉已被接管后重建的新锁（条件删除按自己那一版）", async () => {
    const stale = await acquireManhuaTemplateLifecycleLock();
    // 接管：锁被换成新的一版
    manhuaTemplateLifecycleClock.now = () => realNow() + MANHUA_TEMPLATE_LOCK_TTL_MS + 1_000;
    lockState.generation = "2";
    const fresh = await acquireManhuaTemplateLifecycleLock();
    // 旧持有者此刻才去释放：条件删除的 generation 已经不匹配
    await expect(stale()).rejects.toThrow();
    // 新锁还在，能正常释放
    await fresh();
  });
});

describe("批准的公开码与覆盖保护（终审第六组 13–16）", () => {
  const proposalCard = (over: Record<string, unknown> = {}) =>
    cardOf({ id: "tpl_series_newone", status: "proposed", publicCode: undefined, ...over });

  /** 让 getGcsManhuaViralProposal 读到待批准卡，approved/ 侧按传入清单列举 */
  const seedApprove = (approvedCards: Array<Record<string, unknown>>, proposal: Record<string, unknown>) => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? approvedCards.map((c) => `manhua-template-learn/approved/${c.id}.json`)
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
      const hit = approvedCards.find((c) => String(gcsUri).includes(String(c.id)));
      return {
        buffer: Buffer.from(JSON.stringify(hit || proposal), "utf8"),
      };
    });
    gcs.createIfAbsent.mockResolvedValue({ created: true });
  };

  it("🔴 提案自带的 publicCode 与正式库冲突时重新铸码", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    seedApprove([cardOf({ id: "tpl_series_old", publicCode: "AB12" })],
      proposalCard({ publicCode: "AB12" }));
    const out = await approveManhuaViralTemplate({ id: "tpl_series_newone" });
    expect(out.publicCode).toBeTruthy();
    expect(out.publicCode).not.toBe("AB12");
  });

  it("提案没带码时铸一个新的；不冲突的自带码则沿用", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    seedApprove([cardOf({ id: "tpl_series_old", publicCode: "AB12" })],
      proposalCard({ publicCode: "CD34" }));
    const out = await approveManhuaViralTemplate({ id: "tpl_series_newone" });
    expect(out.publicCode).toBe("CD34");
  });

  it("🔴 正式库严格列举失败时批准停止：不铸码、不写 approved", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(proposalCard()), "utf8"),
    });
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix.includes("/approved/")) throw new Error("gcs_list_failed:503");
      return [];
    });
    await expect(approveManhuaViralTemplate({ id: "tpl_series_newone" })).rejects.toThrow();
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
  });

  it("🔴 非修订提案的 id 已在正式库时拒绝覆盖（要换请走修订流程）", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    // 提案必须真是 proposed（否则会先被「不是待审状态」那道更早的门拦下，测不到这一条）
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? ["manhua-template-learn/approved/tpl_series_newone.json"]
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: Buffer.from(
        JSON.stringify(
          String(gcsUri).includes("/approved/")
            ? cardOf({ id: "tpl_series_newone", publicCode: "AB12" })
            : proposalCard(),
        ),
        "utf8",
      ),
    }));
    gcs.createIfAbsent.mockResolvedValue({ created: true });
    await expect(approveManhuaViralTemplate({ id: "tpl_series_newone" })).rejects.toThrow(
      /已存在，请通过修订流程替换/,
    );
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
  });
});

describe("原生系列卡的滚动批准", () => {
  const nativeSeriesId = "tpl_native_series_serial_a";
  type NativeSeriesFixture = ReturnType<typeof cardOf> & {
    storyStructure: {
      corePromiseZh: string;
      conflictEngineZh: string;
      relationshipEngineZh: string;
      episodeProgressionZh: string[];
      variationRulesZh: string[];
    };
    sourceRefs: Array<{ url: string; fetchedAt: string }>;
    provenance: {
      nativeSeriesAggregation: {
        model: string;
        route: "openrouter_text";
        sourceEpisodeCount: number;
        firstEpisodeIndex: number;
        lastEpisodeIndex: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        priceEquivalentCny: number;
        usingPlanQuota: false;
        snapshotSha256: string;
        aggregatedAt: string;
      };
    };
  };
  const nativeSeriesCard = (input: {
    status: "proposed" | "approved";
    snapshot: string;
    sourceEpisodeCount: number;
    publicCode?: string;
    corePromiseZh: string;
    sourceUrl: string;
  }): NativeSeriesFixture => cardOf({
    id: nativeSeriesId,
    nameZh: input.status === "approved" ? "旧系列结构" : "新系列结构",
    laneZh: "多维标签",
    status: input.status,
    publicCode: input.publicCode,
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    storyStructure: {
      corePromiseZh: input.corePromiseZh,
      conflictEngineZh: `${input.corePromiseZh}的冲突引擎`,
      relationshipEngineZh: `${input.corePromiseZh}的关系引擎`,
      episodeProgressionZh: [`${input.corePromiseZh}逐集升级`],
      variationRulesZh: [`${input.corePromiseZh}每集改变压力来源`],
    },
    sourceRefs: [{ url: input.sourceUrl, fetchedAt: "2026-08-25T12:00:00.000Z" }],
    provenance: {
      nativeSeriesAggregation: {
        model: "z-ai/glm-5.3",
        route: "openrouter_text",
        sourceEpisodeCount: input.sourceEpisodeCount,
        firstEpisodeIndex: 1,
        lastEpisodeIndex: input.sourceEpisodeCount,
        inputTokens: 800,
        outputTokens: 120,
        costUsd: 0.03,
        priceEquivalentCny: 0.216,
        usingPlanQuota: false,
        snapshotSha256: input.snapshot,
        aggregatedAt: "2026-08-25T12:00:00.000Z",
      },
    },
    approvedAt: input.status === "approved" ? "2026-08-24T12:00:00.000Z" : undefined,
  }) as NativeSeriesFixture;

  const seedRollingApprove = (
    oldApproved: Record<string, unknown>,
    newProposal: Record<string, unknown>,
  ) => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? [`${MANHUA_VIRAL_APPROVED_PREFIX}${nativeSeriesId}.json`]
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: Buffer.from(JSON.stringify(
        String(gcsUri).includes("/approved/") ? oldApproved : newProposal,
      ), "utf8"),
    }));
  };

  it("新增分集后同 id 再批准：先归档旧卡，保留公开码，其余核心字段全换新", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    const oldApproved = nativeSeriesCard({
      status: "approved",
      snapshot: "a".repeat(64),
      sourceEpisodeCount: 2,
      publicCode: "KEEP42",
      corePromiseZh: "旧故事承诺",
      sourceUrl: "gs://test-bucket/old-ep1.json",
    });
    const newProposal = nativeSeriesCard({
      status: "proposed",
      snapshot: "b".repeat(64),
      sourceEpisodeCount: 3,
      corePromiseZh: "新故事承诺",
      sourceUrl: "gs://test-bucket/new-ep3.json",
    });
    seedRollingApprove(oldApproved, newProposal);

    const out = await approveManhuaViralTemplate({ id: nativeSeriesId });
    expect(out.publicCode).toBe("KEEP42");
    expect(out.storyStructure?.corePromiseZh).toBe("新故事承诺");
    expect(out.sourceRefs).toEqual(newProposal.sourceRefs);
    expect(out.provenance).toEqual(newProposal.provenance);

    const writes = gcs.upload.mock.calls.map(([params]) => params as {
      objectName: string;
      buffer: Buffer;
    });
    const archiveIndex = writes.findIndex((write) =>
      write.objectName.startsWith(`${MANHUA_VIRAL_ARCHIVE_PREFIX}${nativeSeriesId}/`));
    const approvedIndex = writes.findIndex((write) =>
      write.objectName === `${MANHUA_VIRAL_APPROVED_PREFIX}${nativeSeriesId}.json`);
    expect(archiveIndex).toBeGreaterThanOrEqual(0);
    expect(approvedIndex).toBeGreaterThan(archiveIndex);

    const archived = JSON.parse(writes[archiveIndex]!.buffer.toString("utf8"));
    const approved = JSON.parse(writes[approvedIndex]!.buffer.toString("utf8"));
    expect(archived.storyStructure.corePromiseZh).toBe("旧故事承诺");
    expect(archived.provenance.nativeSeriesAggregation.snapshotSha256).toBe("a".repeat(64));
    expect(approved).toMatchObject({
      publicCode: "KEEP42",
      sourceRefs: newProposal.sourceRefs,
      storyStructure: newProposal.storyStructure,
      provenance: newProposal.provenance,
    });
  });

  it("同一快照不重复归档与覆盖", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    const oldApproved = nativeSeriesCard({
      status: "approved",
      snapshot: "c".repeat(64),
      sourceEpisodeCount: 3,
      publicCode: "KEEP42",
      corePromiseZh: "同一故事承诺",
      sourceUrl: "gs://test-bucket/ep3.json",
    });
    const duplicateProposal = nativeSeriesCard({
      status: "proposed",
      snapshot: "c".repeat(64),
      sourceEpisodeCount: 3,
      corePromiseZh: "同一故事承诺",
      sourceUrl: "gs://test-bucket/ep3.json",
    });
    seedRollingApprove(oldApproved, duplicateProposal);

    await expect(approveManhuaViralTemplate({ id: nativeSeriesId }))
      .rejects.toThrow(/快照未变/);
    expect(gcs.upload).not.toHaveBeenCalled();
  });
});

describe("原生分集部分卡的滚动批准", () => {
  const nativeEpisodeId = "tpl_native_wanyao_ep001";
  const sourceDigest = "a".repeat(64);
  const partialEpisodeCard = (input: {
    status: "proposed" | "approved";
    successSegments: number;
    publicCode?: string;
    snapshot: string;
  }) => cardOf({
    id: nativeEpisodeId,
    nameZh: "多维标签·原生第1集节奏",
    laneZh: "多维标签",
    status: input.status,
    publicCode: input.publicCode,
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    sourceRefs: [{ url: "https://www.douyin.com/video/7641538290936947889", fetchedAt: "2026-08-27" }],
    provenance: {
      nativeVideoDeepRead: {
        model: "gemini-3.1-pro-preview",
        attemptedSegments: 4,
        successSegments: input.successSegments,
        shotCount: 8,
        droppedCount: 0,
        truncated: false,
        usingPlanQuota: false,
        costCny: 1.2,
        completedSegmentIndexes: Array.from({ length: input.successSegments }, (_, index) => index),
        assemblyComplete: input.successSegments === 4,
        sourceDigest,
        snapshotSha256: input.snapshot,
      },
    },
    approvedAt: input.status === "approved" ? "2026-08-27T00:00:00.000Z" : undefined,
  });

  const seedRollingEpisodeApprove = (
    oldApproved: Record<string, unknown>,
    nextProposal: Record<string, unknown>,
  ) => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/approved/")
        ? [`${MANHUA_VIRAL_APPROVED_PREFIX}${nativeEpisodeId}.json`]
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: Buffer.from(JSON.stringify(
        String(gcsUri).includes("/approved/") ? oldApproved : nextProposal,
      ), "utf8"),
    }));
  };

  it("已批准 1/4 后批准 2/4：保留公开码、归档旧卡并单调替换正式卡", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    const oldApproved = partialEpisodeCard({
      status: "approved", successSegments: 1, publicCode: "EPKEEP", snapshot: "b".repeat(64),
    });
    const nextProposal = partialEpisodeCard({
      status: "proposed", successSegments: 2, snapshot: "c".repeat(64),
    });
    seedRollingEpisodeApprove(oldApproved, nextProposal);

    const out = await approveManhuaViralTemplate({ id: nativeEpisodeId });
    expect(out.publicCode).toBe("EPKEEP");
    expect(out.provenance?.nativeVideoDeepRead).toMatchObject({
      successSegments: 2,
      attemptedSegments: 4,
      completedSegmentIndexes: [0, 1],
      assemblyComplete: false,
      sourceDigest,
    });
    const writes = gcs.upload.mock.calls.map(([params]) => params as {
      objectName: string;
      buffer: Buffer;
      ifGenerationMatch?: string;
    });
    const archiveIndex = writes.findIndex((row) =>
      row.objectName.startsWith(`${MANHUA_VIRAL_ARCHIVE_PREFIX}${nativeEpisodeId}/`));
    const approvedIndex = writes.findIndex((row) =>
      row.objectName === `${MANHUA_VIRAL_APPROVED_PREFIX}${nativeEpisodeId}.json`);
    expect(archiveIndex).toBeGreaterThanOrEqual(0);
    expect(approvedIndex).toBeGreaterThan(archiveIndex);
    expect(writes.find((row) =>
      row.objectName === `manhua-template-learn/proposals/${nativeEpisodeId}.json`))
      .toMatchObject({ ifGenerationMatch: "7" });
  });

  it("同剧同集补全只更新同拍描述，并保留先前精华与新增亮点", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    const oldApproved = partialEpisodeCard({
      status: "approved", successSegments: 1, publicCode: "EPKEEP", snapshot: "b".repeat(64),
    });
    Object.assign(oldApproved, {
      summaryZh: "先前已验收的情绪精华",
      hook3sZh: "旧钩子亮点",
      reusableZh: "用静默制造压迫",
      genPromptHintZh: "保留冷色逆光",
      beatGrid: [
        { atSec: 0, endSec: 3, conflictZh: "先声夺人", visualZh: "旧成果独有动作", cameraMoveZh: "快速推近" },
        { atSec: 10, endSec: 12, conflictZh: "信息加码", visualZh: "同一动作", cameraMoveZh: "固定机位" },
      ],
      subtitleTrack: [{ atSec: 1, textZh: "旧字幕证据" }],
      classification: {
        emotionTagsZh: ["压迫渐强", "隐忍"],
        narrativeFeatureTagsZh: ["信息递进"],
        performanceTagsZh: ["克制爆发"],
        audiovisualTagsZh: ["冷暖对撞"],
        audienceExperienceTagsZh: ["持续紧张"],
      },
    });
    const nextProposal = partialEpisodeCard({
      status: "proposed", successSegments: 2, snapshot: "c".repeat(64),
    });
    Object.assign(nextProposal, {
      summaryZh: "新分片发现关系变化",
      hook3sZh: "新钩子亮点",
      reusableZh: "反应镜承接冲突",
      genPromptHintZh: "增加遮挡转场",
      beatGrid: [
        { atSec: 10, endSec: 13, conflictZh: "信息加码", visualZh: "同一动作", cameraMoveZh: "缓慢横移" },
        { atSec: 20, endSec: 24, conflictZh: "关系变化", visualZh: "新分片独有动作", cameraMoveZh: "环绕半圈" },
      ],
      subtitleTrack: [{ atSec: 21, textZh: "新字幕证据" }],
      classification: {
        emotionTagsZh: ["压迫渐强", "释然"],
        narrativeFeatureTagsZh: ["信息递进", "关系转折"],
        performanceTagsZh: ["克制爆发", "眼神停顿"],
        audiovisualTagsZh: ["冷暖对撞", "遮挡转场"],
        audienceExperienceTagsZh: ["持续紧张", "情绪释放"],
      },
    });
    seedRollingEpisodeApprove(oldApproved, nextProposal);

    const out = await approveManhuaViralTemplate({ id: nativeEpisodeId });
    expect(out.summaryZh).toContain("先前已验收的情绪精华");
    expect(out.summaryZh).toContain("新分片发现关系变化");
    expect(out.reusableZh).toContain("用静默制造压迫");
    expect(out.reusableZh).toContain("反应镜承接冲突");
    expect(out.beatGrid).toEqual(expect.arrayContaining([
      expect.objectContaining({ visualZh: "旧成果独有动作" }),
      expect.objectContaining({ visualZh: "新分片独有动作" }),
      expect.objectContaining({ visualZh: "同一动作", cameraMoveZh: "缓慢横移" }),
    ]));
    expect(out.beatGrid).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ visualZh: "同一动作", cameraMoveZh: "固定机位" }),
    ]));
    expect(out.subtitleTrack).toEqual([
      { atSec: 1, textZh: "旧字幕证据" },
      { atSec: 21, textZh: "新字幕证据" },
    ]);
    expect(out.classification?.emotionTagsZh).toEqual(["压迫渐强", "隐忍", "释然"]);
    expect(out.provenance?.nativeVideoDeepRead?.completedSegmentIndexes).toEqual([0, 1]);
    expect(out.provenance?.nativeVideoDeepRead?.shotCount).toBe(out.beatGrid.length);
    expect(out.provenance?.nativeVideoDeepRead?.shotCount).toBe(3);
  });

  it("旧字段与标签已到上限时仍为新分片保留空间，同秒改写不重复计镜", async () => {
    const { mergeNativeEpisodeTemplateLearning } = await import("./manhuaViralTemplateStore");
    const oldApproved = partialEpisodeCard({
      status: "approved", successSegments: 1, publicCode: "EPKEEP", snapshot: "d".repeat(64),
    });
    const nextProposal = partialEpisodeCard({
      status: "proposed", successSegments: 2, snapshot: "e".repeat(64),
    });
    Object.assign(oldApproved, {
      summaryZh: "旧精华".repeat(30),
      beatGrid: [
        { atSec: 10, endSec: 12, conflictZh: "旧措辞", visualZh: "旧动作描述", cameraMoveZh: "固定机位" },
      ],
      classification: {
        emotionTagsZh: Array.from({ length: 8 }, (_, index) => `旧标签${index + 1}`),
        narrativeFeatureTagsZh: ["旧叙事"],
        performanceTagsZh: ["旧表演"],
        audiovisualTagsZh: ["旧视听"],
        audienceExperienceTagsZh: ["旧体验"],
      },
    });
    Object.assign(nextProposal, {
      summaryZh: "新进度亮点",
      beatGrid: [
        { atSec: 10, endSec: 13, conflictZh: "新措辞", visualZh: "新动作描述", cameraMoveZh: "缓慢横移" },
      ],
      classification: {
        emotionTagsZh: ["新标签A", "新标签B"],
        narrativeFeatureTagsZh: ["新叙事"],
        performanceTagsZh: ["新表演"],
        audiovisualTagsZh: ["新视听"],
        audienceExperienceTagsZh: ["新体验"],
      },
    });

    const out = mergeNativeEpisodeTemplateLearning(
      oldApproved as unknown as ManhuaViralTemplateCard,
      nextProposal as unknown as ManhuaViralTemplateCard,
    );
    expect(out.summaryZh).toContain("旧精华");
    expect(out.summaryZh).toContain("新进度亮点");
    expect(out.summaryZh.length).toBeLessThanOrEqual(120);
    expect(out.classification?.emotionTagsZh).toContain("新标签A");
    expect(out.classification?.emotionTagsZh).toContain("旧标签1");
    expect(out.classification?.emotionTagsZh).toHaveLength(8);
    expect(out.beatGrid).toEqual([
      expect.objectContaining({ atSec: 10, visualZh: "新动作描述", cameraMoveZh: "缓慢横移" }),
    ]);
    expect(out.provenance?.nativeVideoDeepRead?.shotCount).toBe(1);
  });

  it("已批准卡含有效音轨时，本轮缺音轨或音轨倒退均拒绝补全", async () => {
    const { mergeNativeEpisodeTemplateLearning } = await import("./manhuaViralTemplateStore");
    const oldApproved = partialEpisodeCard({
      status: "approved", successSegments: 1, publicCode: "EPKEEP", snapshot: "f".repeat(64),
    });
    const nextProposal = partialEpisodeCard({
      status: "proposed", successSegments: 2, snapshot: "1".repeat(64),
    });
    Object.assign(oldApproved, {
      audioStory: { hasAudio: true, durationSec: 360 },
    });
    expect(() => mergeNativeEpisodeTemplateLearning(
      oldApproved as unknown as ManhuaViralTemplateCard,
      nextProposal as unknown as ManhuaViralTemplateCard,
    ))
      .toThrow(/缺少本轮有效音轨/);

    Object.assign(nextProposal, {
      audioStory: { hasAudio: true, durationSec: 300 },
    });
    expect(() => mergeNativeEpisodeTemplateLearning(
      oldApproved as unknown as ManhuaViralTemplateCard,
      nextProposal as unknown as ManhuaViralTemplateCard,
    ))
      .toThrow(/本轮音轨短于已批准进度/);
  });

  it("正式卡已有 2/4 时拒绝批准 1/4 倒退提案", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    seedRollingEpisodeApprove(
      partialEpisodeCard({
        status: "approved", successSegments: 2, publicCode: "EPKEEP", snapshot: "c".repeat(64),
      }),
      partialEpisodeCard({ status: "proposed", successSegments: 1, snapshot: "b".repeat(64) }),
    );
    await expect(approveManhuaViralTemplate({ id: nativeEpisodeId }))
      .rejects.toThrow(/严格进度升级/);
    expect(gcs.upload).not.toHaveBeenCalled();
  });

  it("批准期间 proposal 已推进时只吞 generation 412，保留新版待审", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    seedRollingEpisodeApprove(
      partialEpisodeCard({
        status: "approved", successSegments: 1, publicCode: "EPKEEP", snapshot: "b".repeat(64),
      }),
      partialEpisodeCard({ status: "proposed", successSegments: 2, snapshot: "c".repeat(64) }),
    );
    gcs.upload
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("gcs_upload_failed:412:conditionNotMet"));

    await expect(approveManhuaViralTemplate({ id: nativeEpisodeId }))
      .resolves.toMatchObject({ status: "approved", publicCode: "EPKEEP" });
  });

  it("proposal 状态同步遇到非 412 错误必须上抛，不冒充新版并发", async () => {
    const { approveManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    seedRollingEpisodeApprove(
      partialEpisodeCard({
        status: "approved", successSegments: 1, publicCode: "EPKEEP", snapshot: "b".repeat(64),
      }),
      partialEpisodeCard({ status: "proposed", successSegments: 2, snapshot: "c".repeat(64) }),
    );
    gcs.upload
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("gcs_upload_failed:503"));

    await expect(approveManhuaViralTemplate({ id: nativeEpisodeId }))
      .rejects.toThrow("gcs_upload_failed:503");
  });
});

describe("归档规模：不丢第 201 个（终审第六组 4）", () => {
  it("🔴 250 个唯一归档 id 全部列得出来，不静默截断", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `tpl_series_a${String(i).padStart(3, "0")}`);
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/")
        ? ids.map((id) => `${MANHUA_VIRAL_ARCHIVE_PREFIX}${id}/7.json`)
        : [],
    );
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
      const id = String(gcsUri).match(/archive\/(tpl_[a-z0-9_]+)\//)?.[1] || ID;
      return { buffer: Buffer.from(JSON.stringify(cardOf({ id })), "utf8") };
    });
    const rows = await listArchivedManhuaViralTemplateIndex();
    expect(rows).toHaveLength(250);
    expect(rows.some((r) => r.id === "tpl_series_a249")).toBe(true);
  });

  it("归档对象达到列举硬上限时 fail-closed", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/")
        ? Array.from({ length: 1000 }, (_, i) => `${MANHUA_VIRAL_ARCHIVE_PREFIX}tpl_series_b${i}/7.json`)
        : [],
    );
    await expect(listArchivedManhuaViralTemplateIndex()).rejects.toThrow(/无法确认列表完整/);
  });

  it("归档版本列表同样 fail-closed", async () => {
    gcs.list.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => obj(String(i + 1))));
    await expect(listArchivedManhuaViralTemplateVersions(ID)).rejects.toThrow(
      /无法确认列表完整/,
    );
  });
});
