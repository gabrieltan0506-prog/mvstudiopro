import { describe, expect, it } from "vitest";
import {
  adviseTemplateRetirement,
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

  it("抽帧卡＋同赛道有精读卡 → 建议替换，并指名顶上的那张", () => {
    const better = native({ id: "tpl_new", beatGrid: card().beatGrid });
    const a = adviseTemplateRetirement(frame(), [better]);
    expect(a.action).toBe("replace_with");
    expect(a.replacementId).toBe("tpl_new");
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
