/**
 * 下架归档：顺序、幂等命名、错误分类。
 *
 * 关键不变量：**先写归档、确认成功后才删原件**，且只删读到的那一版。
 * 反过来一旦删成功写失败，模板就没了（一部 58 分钟合辑学一次约 $1.075，无法重建）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seq: string[] = [];
const state = {
  statGeneration: "77" as string | null,
  statStatus: 200,
  deleteStatus: 204,
  card: {} as Record<string, unknown>,
};

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  downloadGcsObjectVersioned: async () => {
    seq.push("download");
    if (state.statStatus !== 200) throw new Error(`gcs_stat_failed:${state.statStatus}`);
    return {
      buffer: Buffer.from(JSON.stringify(state.card), "utf8"),
      bucket: "test-bucket",
      objectName: "o",
      generation: state.statGeneration!,
    };
  },
  uploadBufferToGcsIfAbsent: async (p: { objectName: string }) => {
    seq.push(`upload:${p.objectName}`);
    return { created: true };
  },
  deleteGcsObject: async (p: { ifGenerationMatch?: string }) => {
    seq.push(`delete:${p.ifGenerationMatch}`);
    if (state.deleteStatus === 412) throw new Error("gcs_delete_generation_conflict");
  },
  uploadBufferToGcs: async () => ({ gcsUri: "gs://x/y" }),
  listGcsObjectNamesByPrefix: async () => [],
  downloadGcsObject: async () => ({ buffer: Buffer.from("{}"), bucket: "b", objectName: "o" }),
  signGsUriV4ReadUrl: () => "https://signed",
}));

function approvedCard() {
  return {
    id: "tpl_series_arch01",
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
  };
}

beforeEach(() => {
  seq.length = 0;
  state.statGeneration = "77";
  state.statStatus = 200;
  state.deleteStatus = 204;
  state.card = approvedCard();
});
afterEach(() => vi.resetModules());

describe("archiveApprovedManhuaViralTemplate", () => {
  it("顺序必须是 download → upload → delete，且归档名用 generation", async () => {
    const { archiveApprovedManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    const out = await archiveApprovedManhuaViralTemplate("tpl_series_arch01");
    expect(out.status).toBe("rejected");
    expect(seq).toEqual([
      "download",
      "upload:manhua-template-learn/archive/tpl_series_arch01/77.json",
      "delete:77",
    ]);
  });

  it("条件删除冲突 → 「模板已更新，请刷新后重试」，归档已写入不回滚", async () => {
    state.deleteStatus = 412;
    const { archiveApprovedManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    await expect(archiveApprovedManhuaViralTemplate("tpl_series_arch01")).rejects.toThrow(
      "模板已更新，请刷新后重试",
    );
    expect(seq.some((s) => s.startsWith("upload:"))).toBe(true);
  });

  it("metadata 404 才说「不存在」", async () => {
    state.statStatus = 404;
    const { archiveApprovedManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    await expect(archiveApprovedManhuaViralTemplate("tpl_series_arch01")).rejects.toThrow(
      "正式模板不存在或已下架",
    );
  });

  it("metadata 503 保留原始分类，不许说成不存在", async () => {
    state.statStatus = 503;
    const { archiveApprovedManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    await expect(archiveApprovedManhuaViralTemplate("tpl_series_arch01")).rejects.toThrow(
      "gcs_stat_failed:503",
    );
  });

  it("非 approved 状态不下架", async () => {
    state.card = { ...approvedCard(), status: "proposed", publicCode: undefined };
    const { archiveApprovedManhuaViralTemplate } = await import("./manhuaViralTemplateStore");
    await expect(archiveApprovedManhuaViralTemplate("tpl_series_arch01")).rejects.toThrow(
      /不是已批准状态|无法解析/,
    );
    expect(seq.some((s) => s.startsWith("delete:"))).toBe(false);
  });
});
