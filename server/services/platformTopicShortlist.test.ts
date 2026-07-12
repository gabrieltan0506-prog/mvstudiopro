import { describe, expect, it } from "vitest";
import {
  deriveTopicDedupeKey,
  dedupeTopicShortlist,
  ensureAuthorityCiteInCopy,
  normalizeCommentHook,
  normalizeCommentHooksList,
  textHasAuthorityCite,
} from "../../shared/platformTopicShortlist.js";

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
