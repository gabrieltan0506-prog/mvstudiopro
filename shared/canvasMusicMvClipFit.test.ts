import { describe, expect, it } from "vitest";
import { estimateEnvelopeLagSec, lipSyncCorrelation, planMvClipFit } from "./canvasMusicMvClipFit";

describe("出片实测适配：只裁不变速，不合格段单独重做", () => {
  it("生成段实测够长 → 裁到目标；不够 → 该段重做并写缺口", () => {
    const fit = { shotId: "g", kind: "generated" as const, songStartSec: 150, offsetSec: 0, durationSec: 6.2 };
    expect(planMvClipFit(fit, { measuredSec: 7.04, hasAudio: true })).toMatchObject({ ok: true, trimInSec: 0, trimOutSec: 6.2 });
    const short = planMvClipFit({ ...fit, durationSec: 14.5 }, { measuredSec: 13.5, hasAudio: true });
    expect(short.ok).toBe(false);
    expect(short.shortfallSec).toBe(1);
    expect(short.reasonZh).toContain("需重做该段");
  });
  it("演唱段按原歌时间线落位（trimIn = 入片偏移，不按模型音轨平移）；实测不够唱句尾 → 重做", () => {
    const fit = { shotId: "s", kind: "singing" as const, songStartSec: 18.2, offsetSec: 3.2, durationSec: 11.8 };
    expect(planMvClipFit(fit, { measuredSec: 15.1, hasAudio: true })).toMatchObject({ ok: true, trimInSec: 3.2, trimOutSec: 15 });
    expect(planMvClipFit(fit, { measuredSec: 14.6, hasAudio: true }).reasonZh).toContain("演唱段实测");
  });
  it("视觉口型核验：嘴部张合与人声包络同步 → 通过；错位 5 帧或不相关 → 不通过", () => {
    const vocal = Array.from({ length: 180 }, (_, i) => (Math.sin(i / 4) > 0.3 ? 1 : 0.1) + 0.05 * Math.cos(i));
    const mouth = vocal.map(v => v * 0.8 + 0.02);
    expect(lipSyncCorrelation(mouth, vocal)).toMatchObject({ pass: true, lagFrames: 0 });
    const late = [...Array(5).fill(0.1), ...mouth.slice(0, -5)];
    const r = lipSyncCorrelation(late, vocal);
    expect(r.lagFrames).toBe(5);
    expect(r.pass).toBe(false);
    const noise = vocal.map((_, i) => ((i * 7919) % 13) / 13);
    expect(lipSyncCorrelation(noise, vocal).pass).toBe(false);
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
