import { describe, expect, it } from "vitest";
import {
  buildGraphicNotePagesFromBlueprint,
  deriveTopicDedupeKey,
  dedupeTopicShortlist,
  ensureAuthorityCiteInCopy,
  normalizeCommentHook,
  normalizeCommentHooksList,
  platformTopicShortlistTotalCredits,
  prefersInventoryGraphicNote,
  textHasAuthorityCite,
} from "../../shared/platformTopicShortlist.js";
import { countSuccessfulGateways } from "./platformTopicShortlist";
import { assertUsableExpandedBlueprint } from "./platformTopicShortlist";

describe("deriveTopicDedupeKey", () => {
  it("collapses 王安石 variants", () => {
    expect(deriveTopicDedupeKey("执拗的代价：从王安石的变法焦虑看现代强人")).toBe("figure:王安石");
    expect(deriveTopicDedupeKey("荆公变法与当代内耗")).toBe("figure:王安石");
  });
  it("collapses 深夜高压 motif", () => {
    expect(deriveTopicDedupeKey("凌晨一点的工作群，你的心脏正在经历重金属摇滚")).toBe(
      "motif:深夜高压",
    );
  });
});

describe("dedupeTopicShortlist", () => {
  it("keeps only one item per dedupeKey", () => {
    const out = dedupeTopicShortlist(
      [
        { title: "王安石A", dedupeKey: "figure:王安石", hookSketch: "" },
        { title: "王安石B", dedupeKey: "figure:王安石", hookSketch: "" },
        { title: "爵士留白", dedupeKey: "motif:other", hookSketch: "" },
      ],
      { max: 20 },
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toBe("王安石A");
  });
  it("filters existing titles", () => {
    const out = dedupeTopicShortlist(
      [{ title: "已有题", dedupeKey: "title:x", hookSketch: "" }],
      { existingTitles: ["已有题"], max: 20 },
    );
    expect(out).toHaveLength(0);
  });
});

describe("comment hooks", () => {
  it("clamps to 3 chars and rewrites long CTA", () => {
    expect(normalizeCommentHook("慢生活啊")).toBe("慢生活");
    expect(normalizeCommentHook("预约诊断通话")).toBe("想要");
    expect(normalizeCommentHooksList(["求带", "想要", "想要"])).toEqual(["求带", "想要"]);
  });
});

describe("platformTopicShortlistTotalCredits", () => {
  it("charges base for 6 and extras beyond", () => {
    expect(platformTopicShortlistTotalCredits({ count: 6, baseCredits: 12, extraPerTopic: 2 })).toEqual({
      count: 6,
      included: 6,
      extraCount: 0,
      total: 12,
    });
    expect(platformTopicShortlistTotalCredits({ count: 12, baseCredits: 12, extraPerTopic: 2 }).total).toBe(
      12 + 6 * 2,
    );
    expect(platformTopicShortlistTotalCredits({ count: 20, baseCredits: 12, extraPerTopic: 2 }).total).toBe(
      12 + 14 * 2,
    );
  });
});

describe("authority cite", () => {
  it("detects and patches when missing on fmcg", () => {
    expect(textHasAuthorityCite("按《中国居民膳食指南（2022）》建议少糖")).toBe(true);
    const r = ensureAuthorityCiteInCopy({
      copywriting: "雪糕很好吃但要算账。",
      lane: "fmcg",
    });
    expect(r.patched).toBe(true);
    expect(textHasAuthorityCite(r.copywriting)).toBe(true);
  });
});

describe("inventory graphic note fallback", () => {
  it("builds inventory_index + detail_card for 合集 titles", () => {
    expect(prefersInventoryGraphicNote("上海7月不可错过重磅展览合集，大部分免费")).toBe(true);
    const pages = buildGraphicNotePagesFromBlueprint({
      title: "上海7月不可错过重磅展览合集，大部分免费",
      hook: "28场热门展览",
      commentHook: "清单",
    });
    expect(pages.some((p) => p.role === "inventory_index")).toBe(true);
    expect(pages.filter((p) => p.role === "detail_card").length).toBeGreaterThanOrEqual(2);
    expect(pages.length).toBeGreaterThanOrEqual(8);
  });
});

describe("assertUsableExpandedBlueprint（0824 审阅补齐：空串必须拒）", () => {
  const ok = {
    title: "标题",
    copywriting: "正文",
    detailedScript: "【封面】",
  };
  const wrap = (bp: Record<string, unknown>) => JSON.stringify({ blueprint: bp });

  it("三字段齐全且非空 → 通过", () => {
    expect(() => assertUsableExpandedBlueprint(wrap(ok))).not.toThrow();
  });

  it("裸对象（无 blueprint 包装）也接受", () => {
    expect(() => assertUsableExpandedBlueprint(JSON.stringify(ok))).not.toThrow();
  });

  it('title="" 拒绝 —— 空串也是 string，只查 typeof 会放它过去', () => {
    expect(() => assertUsableExpandedBlueprint(wrap({ ...ok, title: "" }))).toThrow(/title/);
  });

  it('copywriting="   " 拒绝 —— 纯空白同样是空', () => {
    expect(() => assertUsableExpandedBlueprint(wrap({ ...ok, copywriting: "   " }))).toThrow(
      /copywriting/,
    );
  });

  it('detailedScript="" 拒绝', () => {
    expect(() => assertUsableExpandedBlueprint(wrap({ ...ok, detailedScript: "" }))).toThrow(
      /detailedScript/,
    );
  });

  it("多个字段同时缺 → 错误信息把它们都点出来", () => {
    expect(() =>
      assertUsableExpandedBlueprint(wrap({ title: "", copywriting: "", detailedScript: "x" })),
    ).toThrow(/title,copywriting/);
  });

  it("非 JSON → 三个字段全部报缺（bp 为 null 时每项都取不到）", () => {
    // 注意：实现里的 `missing.join(",") || "blueprint"` 后半段是死分支——
    // bp 为 null 时 missing 必然是全部三项，永远轮不到 "blueprint"
    expect(() => assertUsableExpandedBlueprint("不是 JSON")).toThrow(
      /title,copywriting,detailedScript/,
    );
  });
});

describe("successfulGatewayCounts 汇总口径（0824 审阅补齐）", () => {
  /**
   * 直接测生产实现。原先这里自建了一份同构的 reduce ——
   * 生产实现被删掉或改错，测试照样全绿，测的是复制品等于没测。
   */
  const countBy = countSuccessfulGateways;

  it("能区分套餐与按量通道各成功了几条", () => {
    expect(
      countBy([
        { gateway: "bailian_plan" },
        { gateway: "bailian_plan" },
        { gateway: "evolink" },
        { gateway: "openrouter" },
        { gateway: "bailian_plan" },
      ]),
    ).toEqual({ bailian_plan: 3, evolink: 1, openrouter: 1 });
  });

  it("全部走套餐时按量通道不出现在计数里", () => {
    expect(countBy([{ gateway: "bailian_plan" }, { gateway: "bailian_plan" }])).toEqual({
      bailian_plan: 2,
    });
  });

  it("空结果返回空对象，不是 undefined", () => {
    expect(countBy([])).toEqual({});
  });
});
