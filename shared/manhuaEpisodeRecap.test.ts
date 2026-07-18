import { describe, expect, it } from "vitest";
import {
  MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED,
  MANHUA_RECAP_MIN_EPISODE,
  assertManhuaRecapMontagePhaseCNotWired,
  buildManhuaPreviouslyOnRecap,
  buildManhuaRecapCardImagePrompt,
  planManhuaRecapMontagePhaseC,
  shouldAttachManhuaPreviouslyOn,
} from "./manhuaEpisodeRecap.js";

describe("manhua episode recap (B + C stub)", () => {
  it("attaches from episode 3", () => {
    expect(MANHUA_RECAP_MIN_EPISODE).toBe(3);
    expect(shouldAttachManhuaPreviouslyOn(2)).toBe(false);
    expect(shouldAttachManhuaPreviouslyOn(3)).toBe(true);
  });

  it("builds different recaps for different prior sets", () => {
    const prior12 = [
      { index: 1, title: "石门异响", body: "听见异响", endHook: "门缝透出冷光" },
      { index: 2, title: "冷光之后", body: "推门", endHook: "身后有人叫她本名" },
    ];
    const prior123 = [
      ...prior12,
      { index: 3, title: "本名", body: "回头", endHook: "玉佩碎裂" },
    ];
    const r3 = buildManhuaPreviouslyOnRecap(prior12);
    const r4 = buildManhuaPreviouslyOnRecap(prior123);
    expect(r3).toContain("【前情提要·片头】");
    expect(r3).toContain("第1集");
    expect(r3).toContain("第2集");
    expect(r3).not.toContain("玉佩碎裂");
    expect(r4).toContain("玉佩碎裂");
    expect(r3).not.toEqual(r4);
  });

  it("recap card prompt is title-card oriented", () => {
    const p = buildManhuaRecapCardImagePrompt({
      episodeIndex: 3,
      seriesTitle: "石门冷光",
      recapText: "【前情提要·片头】\n- 第1集",
    });
    expect(p).toMatch(/前情提要/);
    expect(p).toMatch(/9:16/);
  });

  it("phase C stub stays disabled", () => {
    expect(MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED).toBe(false);
    const plan = planManhuaRecapMontagePhaseC({
      episodeIndex: 3,
      priorClipUrls: ["https://cdn.example/ep1.mp4"],
    });
    expect(plan.enabled).toBe(false);
    expect(plan.phase).toBe("C");
    expect(plan.sourceClipUrls).toHaveLength(1);
    expect(() => assertManhuaRecapMontagePhaseCNotWired()).not.toThrow();
  });
});
