/**
 * 归档查看与恢复的**存储层行为**。
 *
 * 立此文件的由头：这条链原来把「读不动」和「没有」压成同一个结果——
 * 列举失败 catch 成 []、单张读失败 continue 掉，页面最后显示「还没有归档版本」。
 * 用户据此以为旧版没了，实际只是 GCS 抖了一下。归档件是花钱学来的，
 * 一部 58 分钟合辑学一次约 $1.075，不能靠「看起来没有」下结论。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 批准/下架/恢复共用一把 GCS 生命周期锁，所以 mock 必须让锁能真的拿到与释放：
 * 锁对象走 `uploadBufferToGcsIfAbsent` 建、`downloadGcsObjectVersioned` 回读比对 token。
 * 不 mock 它，所有写操作都会卡在「另一项操作正在处理」。
 */
const LOCK_OBJECT = "manhua-template-learn/locks/approved-lifecycle.json";
const lockState = vi.hoisted(() => ({ body: Buffer.from("{}"), held: false })) as { body: Buffer; held: boolean };

const gcs = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  createIfAbsent: vi.fn(),
  /** 恢复成功后同步 proposals/ 审计副本走这条，要能断言内容 */
  upload: vi.fn(async () => ({})),
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
  downloadGcsObjectVersioned: async ({ gcsUri }: { gcsUri: string }) => {
    if (String(gcsUri).endsWith(LOCK_OBJECT)) {
      return { buffer: lockState.body, generation: "1" };
    }
    throw new Error("unexpected versioned download");
  },
  deleteGcsObject: async ({ objectName }: { objectName: string }) => {
    if (objectName === LOCK_OBJECT) lockState.held = false;
  },
}));

import {
  acquireManhuaTemplateLifecycleLock,
  archiveApprovedManhuaViralTemplate,
  compareGenerationDesc,
  listArchivedManhuaViralTemplateIndex,
  listArchivedManhuaViralTemplateVersions,
  restoreArchivedManhuaViralTemplate,
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
  gcs.upload.mockClear();
  gcs.list.mockReset();
  gcs.download.mockReset();
  gcs.createIfAbsent.mockReset();
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
    await expect(listGcsManhuaViralApprovedStrict()).rejects.toThrow(/无法确认是否完整/);
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

  it("同一 id 多个版本时只取最新那版（按 generation 数值）", async () => {
    gcs.list.mockImplementation(async ({ prefix }: { prefix: string }) =>
      prefix.includes("/archive/")
        ? [`${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/9.json`,
           `${MANHUA_VIRAL_ARCHIVE_PREFIX}${ID}/10.json`]
        : [],
    );
    const seen: string[] = [];
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
      seen.push(String(gcsUri));
      return { buffer: Buffer.from(JSON.stringify(cardOf()), "utf8") };
    });
    const rows = await listArchivedManhuaViralTemplateIndex();
    expect(rows).toHaveLength(1);
    // 只读了最新那一版，没有把每版都下载一遍
    expect(seen.filter((u) => u.endsWith("10.json"))).toHaveLength(1);
    expect(seen.some((u) => u.endsWith("9.json"))).toBe(false);
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
