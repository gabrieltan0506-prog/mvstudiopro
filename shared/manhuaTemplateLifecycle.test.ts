import { describe, expect, it } from "vitest";
import {
  adviseTemplateRetirement,
  templateMaterialKey,
  canRetireTemplate,
  templateLearnGeneration,
} from "./manhuaTemplateLifecycle";
import type { ManhuaViralTemplateCard } from "./manhuaViralTemplateBank";

const card = (over: Partial<ManhuaViralTemplateCard> = {}): ManhuaViralTemplateCard =>
  ({
    id: "tpl_a",
    nameZh: "卡",
    laneZh: "悬疑权谋",
    summaryZh: "s",
    hook3sZh: "h",
    beatGrid: Array.from({ length: 24 }, (_, i) => ({
      atSec: i,
      conflictZh: "c",
      visualZh: "v",
    })),
    scenePoolHints: [],
    castShape: { leadDesireZh: "a", pressureZh: "b" },
    densityHints: { minBodyChars: 1, minDialogueLines: 1, minLocationHits: 1 },
    sourceRefs: [],
    status: "approved",
    ...over,
  }) as ManhuaViralTemplateCard;

const native = (over: Partial<ManhuaViralTemplateCard> = {}) =>
  card({
    provenance: {
      nativeVideoDeepRead: {
        model: "qwen3.8-max",
        attemptedSegments: 6,
        successSegments: 6,
        shotCount: 95,
        droppedCount: 0,
        truncated: false,
        costCny: 1,
      },
    },
    ...over,
  });

const frame = (over: Partial<ManhuaViralTemplateCard> = {}) =>
  card({
    provenance: {
      frameVision: { provider: "openai", model: "gpt-5", attemptedChunks: 9, successChunks: 8 },
    },
    ...over,
  });

describe("分辨是哪一代学法", () => {
  it("原生精读 / 抽帧 / 来源不明", () => {
    expect(templateLearnGeneration(native())).toBe("native_deep_read");
    expect(templateLearnGeneration(frame())).toBe("frame_vision");
    expect(templateLearnGeneration(card())).toBe("unknown");
  });
});

describe("处置建议", () => {
  it("精读卡保留，不折腾", () => {
    expect(adviseTemplateRetirement(native()).action).toBe("keep");
  });

  it("抽帧卡＋**同素材**有正式精读卡 → 建议替换，并指名顶上的那张", () => {
    // id 必须符合契约（tpl_series_<key> / tpl_native_<key>_epNNN）才认得出同源；
    // 原先用的 tpl_a / tpl_new 认不出素材，等于只按赛道推荐——那会拿别的作品顶上来
    const older = frame({ id: "tpl_series_wanyao" });
    const better = native({
      id: "tpl_native_wanyao_ep001",
      status: "approved",
      beatGrid: card().beatGrid,
    });
    const a = adviseTemplateRetirement(older, [better]);
    expect(a.action).toBe("replace_with");
    expect(a.replacementId).toBe("tpl_native_wanyao_ep001");
    expect(a.reasonZh).toContain("归档仍可查、可恢复");
  });

  it("跨赛道的精读卡不算替代品", () => {
    const other = native({ id: "tpl_other", laneZh: "甜宠" });
    expect(adviseTemplateRetirement(frame(), [other]).action).toBe("consider_relearn");
  });

  it("镜头数比现役少的不算够格顶上", () => {
    const thin = native({ id: "tpl_thin", beatGrid: card().beatGrid.slice(0, 5) });
    expect(adviseTemplateRetirement(frame(), [thin]).action).toBe("consider_relearn");
  });

  it("抽帧卡没有替代品 → 建议重学，理由说清为什么抽帧不够", () => {
    const a = adviseTemplateRetirement(frame());
    expect(a.action).toBe("consider_relearn");
    expect(a.reasonZh).toContain("帧间差分");
  });

  it("来源不明的旧卡也建议重学", () => {
    expect(adviseTemplateRetirement(card()).reasonZh).toContain("来源不明");
  });
});

describe("淘汰安全检查", () => {
  it("同赛道最后一张不许下架 —— 下完编剧室就选不出模板了", () => {
    const r = canRetireTemplate({ card: frame(), sameLaneApprovedCount: 1 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("先批准替代卡");
  });

  it("非 approved 的没什么可淘汰", () => {
    expect(canRetireTemplate({ card: frame({ status: "proposed" }), sameLaneApprovedCount: 5 }).ok)
      .toBe(false);
  });

  it("下架精读卡要二次确认 —— 那是当前门槛最高的一代", () => {
    const r = canRetireTemplate({ card: native(), sameLaneApprovedCount: 3 });
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.warnZh).toContain("确认要下架");
  });

  it("普通情形直接放行", () => {
    expect(canRetireTemplate({ card: frame(), sameLaneApprovedCount: 3 })).toEqual({ ok: true });
  });
});

describe("替代候选必须同源（与 #1299 配套）", () => {
  /**
   * ⚠️ 我上一版这组测试用 `tpl_series_abc` 配 `tpl_native_s1_ep*` —— seriesKey 根本不同，
   * 却断言「应当 replace_with」，等于把「只看同赛道」这个错口径锁成了正确行为。
   * 同赛道下有一堆不同作品，拿 A 剧的精读卡顶 B 剧的旧卡就是推荐错模板。
   */
  const beats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ atSec: i, conflictZh: "冲突", visualZh: "画面" }));

  const oldCard = (over: Record<string, unknown> = {}) =>
    ({
      id: "tpl_series_wanyao",
      nameZh: "旧卡",
      laneZh: "悬念紧逼",
      status: "approved",
      beatGrid: beats(10),
      provenance: {
        frameVision: { provider: "openrouter", model: "terra", attemptedChunks: 1, successChunks: 1 },
      },
      ...over,
    }) as never;

  const nativeCard = (id: string, shots: number, over: Record<string, unknown> = {}) =>
    ({
      id,
      nameZh: id,
      laneZh: "悬念紧逼",
      status: "proposed",
      beatGrid: beats(shots),
      provenance: {
        nativeVideoDeepRead: {
          model: "qwen3.8-max",
          attemptedSegments: 1,
          successSegments: 1,
          shotCount: shots,
          droppedCount: 0,
          truncated: false,
        },
      },
      ...over,
    }) as never;

  it("🔴 同赛道但**不同素材**，不得推荐替换", () => {
    const advice = adviseTemplateRetirement(oldCard(), [
      nativeCard("tpl_native_bieder_ep001", 40),
    ]);
    expect(advice.action).toBe("consider_relearn");
    expect(advice.replacementId).toBeUndefined();
  });

  it("同 seriesKey 的 tpl_series_* 与 tpl_native_*_epNNN 识别为同源", () => {
    const advice = adviseTemplateRetirement(oldCard(), [
      nativeCard("tpl_native_wanyao_ep001", 20),
    ]);
    expect(advice.action).toBe("replace_with");
    expect(advice.replacementId).toBe("tpl_native_wanyao_ep001");
  });

  it("🔴 候选还在待审时，文案必须说「先批准」，不得写成已可使用", () => {
    const advice = adviseTemplateRetirement(oldCard(), [
      nativeCard("tpl_native_wanyao_ep001", 20, { status: "proposed" }),
    ]);
    expect(advice.reasonZh).toContain("先批准");
    expect(advice.reasonZh).not.toContain("可下架本卡改用它");
  });

  it("同时存在待审与正式候选时，优先正式卡", () => {
    const advice = adviseTemplateRetirement(oldCard(), [
      nativeCard("tpl_native_wanyao_ep002", 40, { status: "proposed" }),
      nativeCard("tpl_native_wanyao_ep003", 20, { status: "approved" }),
    ]);
    // 正式卡镜头更少，仍优先——待审卡进不了编剧室
    expect(advice.replacementId).toBe("tpl_native_wanyao_ep003");
    expect(advice.reasonZh).toContain("可下架本卡改用它");
  });

  it("同源同状态时取镜头数最多的（几十张逐集卡里 ep001 未必最全）", () => {
    const advice = adviseTemplateRetirement(oldCard(), [
      nativeCard("tpl_native_wanyao_ep001", 12, { status: "approved" }),
      nativeCard("tpl_native_wanyao_ep002", 40, { status: "approved" }),
      nativeCard("tpl_native_wanyao_ep003", 25, { status: "approved" }),
    ]);
    expect(advice.replacementId).toBe("tpl_native_wanyao_ep002");
    expect(advice.reasonZh).toContain("40 镜");
  });

  it("优化提案按 revision.parentTemplateId 判来源，不看自己的 id", () => {
    const polished = nativeCard("tpl_polish_xxxx", 30, {
      status: "approved",
      revision: { parentTemplateId: "tpl_native_wanyao_ep001", generation: 2 },
    });
    expect(templateMaterialKey(polished)).toBe("wanyao");
    expect(adviseTemplateRetirement(oldCard(), [polished]).action).toBe("replace_with");
  });

  it("认不出素材 key 的卡不参与推荐（宁可不推荐，不乱推荐）", () => {
    const advice = adviseTemplateRetirement(oldCard(), [nativeCard("tpl_freeform_001", 40)]);
    expect(advice.action).toBe("consider_relearn");
  });

  it("镜头数少于现役的同源卡不算够格顶上", () => {
    const advice = adviseTemplateRetirement(oldCard(), [
      nativeCard("tpl_native_wanyao_ep001", 3),
    ]);
    expect(advice.action).toBe("consider_relearn");
  });
});
