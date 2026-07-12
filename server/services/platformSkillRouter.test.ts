import { describe, expect, it } from "vitest";
import {
  PLATFORM_SKILL_ROUTER_CORE_IDS,
  planDiverseBlueprintSkillRoutes,
  resolveSkillPoolIds,
  routePlatformSkillIds,
} from "../../shared/platformSkillRouter.js";

const FULL_POOL = [
  ...PLATFORM_SKILL_ROUTER_CORE_IDS,
  "batch-arc-engagement",
  "4season-fmcg-popsci",
  "label-debunk-copy",
  "authority-cite-endorsement",
  "fmcg-popsci-monetize",
  "forensic-life-lens",
  "crossover-popsci",
  "contrast-reversal-climax",
  "director-craft",
  "graphic-note-rhythm",
  "xhs-collectible-note",
];

const SIX_DIMS = [
  { dimIndex: 0, dimName: "专业洞察" },
  { dimIndex: 1, dimName: "跨界价值观" },
  { dimIndex: 2, dimName: "痛点暴击" },
  { dimIndex: 3, dimName: "人设魅力" },
  { dimIndex: 4, dimName: "强冲突" },
  { dimIndex: 5, dimName: "长尾常青" },
];

describe("routePlatformSkillIds", () => {
  it("routes fmcg lane for ice-cream / label context", () => {
    const r = routePlatformSkillIds({
      poolIds: FULL_POOL,
      context: "如果每天都来一根雪糕，先看配料表从高到低",
      sheetKind: "video",
    });
    expect(r.primaryLane).toBe("fmcg");
    expect(r.selectedIds).toContain("4season-fmcg-popsci");
    expect(r.selectedIds).toContain("label-debunk-copy");
    expect(r.selectedIds).toContain("hook-solution-cta");
    expect(r.selectedIds).toContain("director-craft");
    expect(r.selectedIds).not.toContain("forensic-life-lens");
    expect(r.selectedIds).not.toContain("crossover-popsci");
  });

  it("routes forensic lane for seatbelt / 保命 context", () => {
    const r = routePlatformSkillIds({
      poolIds: FULL_POOL,
      context: "安全带不是怂：法医视角的保命习惯",
      sheetKind: "graphic",
    });
    expect(r.primaryLane).toBe("forensic");
    expect(r.selectedIds).toContain("forensic-life-lens");
    expect(r.selectedIds).toContain("authority-cite-endorsement");
    expect(r.selectedIds).toContain("graphic-note-rhythm");
    expect(r.selectedIds).toContain("xhs-collectible-note");
    expect(r.selectedIds).not.toContain("4season-fmcg-popsci");
  });

  it("default lane keeps core only specialty-wise when no signal", () => {
    const r = routePlatformSkillIds({
      poolIds: FULL_POOL,
      context: "本周行程与会议室纪要分享",
      sheetKind: "unknown",
    });
    expect(r.primaryLane).toBe("default");
    expect(r.selectedIds).toContain("vivid-anti-boring");
    expect(r.selectedIds).toContain("batch-arc-engagement");
    expect(r.selectedIds).not.toContain("forensic-life-lens");
    expect(r.selectedIds).not.toContain("4season-fmcg-popsci");
  });

  it("never selects skills outside the pool", () => {
    const r = routePlatformSkillIds({
      poolIds: ["hook-solution-cta", "cover-stop-scroll", "forensic-life-lens"],
      context: "雪糕配料表打脸与添加糖",
    });
    expect(r.primaryLane).toBe("fmcg");
    expect(r.selectedIds).not.toContain("4season-fmcg-popsci");
    expect(r.selectedIds).toContain("hook-solution-cta");
    expect(
      r.selectedIds.every((id) =>
        ["hook-solution-cta", "cover-stop-scroll", "forensic-life-lens"].includes(id),
      ),
    ).toBe(true);
  });
});

describe("planDiverseBlueprintSkillRoutes", () => {
  it("assigns mutually exclusive specialty lanes across six dims when pool is full", () => {
    const plans = planDiverseBlueprintSkillRoutes({
      poolIds: FULL_POOL,
      baseContext: "哈佛医学院人设的生活方式内容周计划",
      dimensions: SIX_DIMS,
    });
    expect(plans).toHaveLength(6);
    const specialty = plans.map((p) => p.lane).filter((l) => l !== "default");
    expect(new Set(specialty).size).toBe(specialty.length);
    expect(new Set(specialty)).toEqual(new Set(["crossover", "forensic", "fmcg", "contrast"]));
    expect(plans[0]!.selectedIds).toContain("crossover-popsci");
    expect(plans[1]!.selectedIds).toContain("forensic-life-lens");
    expect(plans[2]!.selectedIds).toContain("4season-fmcg-popsci");
    expect(plans[3]!.selectedIds).toContain("contrast-reversal-climax");
  });

  it("lets strong context claim first free specialty without duplicating", () => {
    const plans = planDiverseBlueprintSkillRoutes({
      poolIds: FULL_POOL,
      baseContext: "雪糕配料表打脸与添加糖科普",
      dimensions: SIX_DIMS,
    });
    const fmcgDims = plans.filter((p) => p.lane === "fmcg");
    expect(fmcgDims).toHaveLength(1);
    const specialty = plans.map((p) => p.lane).filter((l) => l !== "default");
    expect(new Set(specialty).size).toBe(specialty.length);
  });

  it("falls back to default when specialty skills absent from pool", () => {
    const plans = planDiverseBlueprintSkillRoutes({
      poolIds: [...PLATFORM_SKILL_ROUTER_CORE_IDS, "batch-arc-engagement"],
      baseContext: "安全带保命与雪糕配料",
      dimensions: SIX_DIMS,
    });
    expect(plans.every((p) => p.lane === "default")).toBe(true);
    expect(plans[0]!.selectedIds).toContain("batch-arc-engagement");
  });
});

describe("resolveSkillPoolIds", () => {
  it("uses enabled list when provided including empty", () => {
    expect(resolveSkillPoolIds({ enabledSkillIds: ["a"], fallbackPoolIds: ["b"] })).toEqual(["a"]);
    expect(resolveSkillPoolIds({ enabledSkillIds: [], fallbackPoolIds: ["b"] })).toEqual([]);
  });
  it("falls back when enabledSkillIds is null", () => {
    expect(resolveSkillPoolIds({ enabledSkillIds: null, fallbackPoolIds: ["x", "y"] })).toEqual([
      "x",
      "y",
    ]);
  });
});
