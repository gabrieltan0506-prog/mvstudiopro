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

/**
 * 下架现在要先占**生命周期锁**、再用严格全量列表过「最后一张」这道门。
 * mock 必须让锁能拿到与释放（锁走 uploadBufferToGcsIfAbsent 建、
 * downloadGcsObjectVersioned 回读比对 token），并给 approved/ 前缀一份完整列表——
 * 否则每条用例都会卡在「另一项操作正在处理」或「无法确认完整正式库」。
 */
const LOCK_OBJECT = "manhua-template-learn/locks/approved-lifecycle.json";
const lockState = vi.hoisted(() => ({ body: Buffer.from("{}"), held: false })) as { body: Buffer; held: boolean };

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  listGcsObjectNamesByPrefix: async ({ prefix }: { prefix: string }) =>
    prefix.includes("/approved/")
      // 同赛道给两张，让「最后一张」那道门放行；目标卡与 state.card 同 id
      ? ["manhua-template-learn/approved/tpl_series_arch01.json",
         "manhua-template-learn/approved/tpl_series_other01.json"]
      : [],
  // 严格全量列表**与 state.card 解耦**：它只用来过「最后一张」这道门，
  // 而各条用例要测的是门之后的流程（顺序 / 404 / 503 / 非 approved）。
  // 若跟着 state 变，门会先把用例拦掉，测不到真正想测的分支。
  downloadGcsObject: async ({ gcsUri }: { gcsUri: string }) => ({
    buffer: Buffer.from(
      JSON.stringify(
        String(gcsUri).includes("other01")
          ? { ...approvedCard(), id: "tpl_series_other01", publicCode: "ZZ99" }
          : approvedCard(),
      ),
      "utf8",
    ),
  }),
  downloadGcsObjectVersioned: async ({ gcsUri }: { gcsUri?: string } = {}) => {
    if (String(gcsUri || "").endsWith(LOCK_OBJECT)) {
      return { buffer: lockState.body, generation: "1" };
    }
    seq.push("download");
    if (state.statStatus !== 200) throw new Error(`gcs_stat_failed:${state.statStatus}`);
    return {
      buffer: Buffer.from(JSON.stringify(state.card), "utf8"),
      bucket: "test-bucket",
      objectName: "o",
      generation: state.statGeneration!,
    };
  },
  uploadBufferToGcs: async () => ({ gcsUri: "gs://x/y" }),
  uploadBufferToGcsIfAbsent: async (p: { objectName: string; buffer: Buffer }) => {
    if (p.objectName === LOCK_OBJECT) {
      if (lockState.held) return { created: false };
      lockState.held = true;
      lockState.body = p.buffer;
      return { created: true };
    }
    seq.push(`upload:${p.objectName}`);
    return { created: true };
  },
  deleteGcsObject: async (p: { objectName?: string; ifGenerationMatch?: string }) => {
    if (p.objectName === LOCK_OBJECT) {
      lockState.held = false;
      return;
    }
    seq.push(`delete:${p.ifGenerationMatch}`);
    if (state.deleteStatus === 412) throw new Error("gcs_delete_generation_conflict");
  },
  // ⚠️ listGcsObjectNamesByPrefix / downloadGcsObject 已在上面定义。
  // 这里原本又写了一遍空实现——同一个对象字面量里重复的键**后者胜**，
  // 于是严格全量列表恒空、下架永远被门拦住。同一个东西不要定义两遍。
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
  lockState.held = false;
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
