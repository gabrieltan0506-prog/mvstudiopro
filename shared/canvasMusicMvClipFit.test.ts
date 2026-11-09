import { describe, expect, it } from "vitest";
import { estimateEnvelopeLagSec, planMvClipFit } from "./canvasMusicMvClipFit";

describe("出片实测适配：只裁不变速，不合格段单独重做", () => {
  it("生成段实测够长 → 裁到目标；不够 → 该段重做并写缺口", () => {
    const fit = { shotId: "g", kind: "generated" as const, songStartSec: 150, offsetSec: 0, durationSec: 6.2 };
    expect(planMvClipFit(fit, { measuredSec: 7.04, hasAudio: true })).toMatchObject({ ok: true, trimInSec: 0, trimOutSec: 6.2 });
    const short = planMvClipFit({ ...fit, durationSec: 14.5 }, { measuredSec: 13.5, hasAudio: true });
    expect(short.ok).toBe(false);
    expect(short.shortfallSec).toBe(1);
    expect(short.reasonZh).toContain("需重做该段");
  });
  it("演唱段按偏移落位；漂移 > 2 帧、相关度低或晚起 → 不合格", () => {
    const fit = { shotId: "s", kind: "singing" as const, songStartSec: 60, offsetSec: 0, durationSec: 5 };
    expect(planMvClipFit(fit, { measuredSec: 6.04, hasAudio: true, lagHeadSec: 0.12, lagTailSec: 0.13, confidence: 0.8 })).toMatchObject({ ok: true, trimInSec: 0.12, trimOutSec: 5.12 });
    expect(planMvClipFit(fit, { measuredSec: 6.04, hasAudio: true, lagHeadSec: 0.1, lagTailSec: 0.2, confidence: 0.8 }).ok).toBe(false);
    expect(planMvClipFit(fit, { measuredSec: 6.04, hasAudio: true, lagHeadSec: 0.1, lagTailSec: 0.1, confidence: 0.1 }).ok).toBe(false);
    expect(planMvClipFit(fit, { measuredSec: 6.04, hasAudio: true, lagHeadSec: -0.2, lagTailSec: -0.2, confidence: 0.9 }).ok).toBe(false);
    expect(planMvClipFit(fit, { measuredSec: 6.04, hasAudio: true, lagHeadSec: -0.02, lagTailSec: -0.02, confidence: 0.9 })).toMatchObject({ ok: true, trimInSec: 0 });
    expect(planMvClipFit(fit, { measuredSec: 6.04, hasAudio: false }).ok).toBe(false);
  });
  it("包络互相关能找回已知延迟（±10ms）", () => {
    const rate = 8000;
    const make = (delay: number) => {
      const a = new Float32Array(rate * 4);
      for (const t of [0.3, 0.75, 1.1, 1.9, 2.2, 2.95, 3.4]) for (let i = 0; i < 400; i++) a[Math.round((t + delay) * rate) + i] = Math.sin(i / 3) * (1 - i / 400);
      return a;
    };
    const { lagSec, confidence } = estimateEnvelopeLagSec(make(0), make(0.23), rate, 1);
    expect(Math.abs(lagSec - 0.23)).toBeLessThanOrEqual(0.011);
    expect(confidence).toBeGreaterThan(0.5);
  });
});
