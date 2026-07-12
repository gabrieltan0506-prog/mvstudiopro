import { describe, expect, it } from "vitest";
import {
  PLATFORM_SKILL_ROUTER_CORE_IDS,
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
    expect(r.selectedIds.every((id) => ["hook-solution-cta", "cover-stop-scroll", "forensic-life-lens"].includes(id))).toBe(
      true,
    );
  });
});

describe("resolveSkillPoolIds", () => {
  it("uses enabled list when provided including empty", () => {
    expect(resolveSkillPoolIds({ enabledSkillIds: ["a"], fallbackPoolIds: ["b"] })).toEqual(["a"]);
    expect(resolveSkillPoolIds({ enabledSkillIds: [], fallbackPoolIds: ["b"] })).toEqual([]);
  });
  it("falls back when enabledSkillIds is null", () => {
    expect(resolveSkillPoolIds({ enabledSkillIds: null, fallbackPoolIds: ["x", "y"] })).toEqual(["x", "y"]);
  });
});
