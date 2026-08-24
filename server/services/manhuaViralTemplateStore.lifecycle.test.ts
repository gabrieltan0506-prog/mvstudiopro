/**
 * 归档查看与恢复的**存储层行为**。
 *
 * 立此文件的由头：这条链原来把「读不动」和「没有」压成同一个结果——
 * 列举失败 catch 成 []、单张读失败 continue 掉，页面最后显示「还没有归档版本」。
 * 用户据此以为旧版没了，实际只是 GCS 抖了一下。归档件是花钱学来的，
 * 一部 58 分钟合辑学一次约 $1.075，不能靠「看起来没有」下结论。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gcs = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  createIfAbsent: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  listGcsObjectNamesByPrefix: gcs.list,
  downloadGcsObject: gcs.download,
  uploadBufferToGcsIfAbsent: gcs.createIfAbsent,
  downloadGcsObjectVersioned: vi.fn(),
  deleteGcsObject: vi.fn(),
}));

import {
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
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(cardOf()), "utf8"),
    });
    gcs.createIfAbsent.mockResolvedValue({ created: false });
    await expect(
      restoreArchivedManhuaViralTemplate({ id: ID, generation: "77" }),
    ).rejects.toThrow(/先下架现役版本/);
  });

  it("正常恢复：状态转 approved、时间戳刷新，走条件创建", async () => {
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
