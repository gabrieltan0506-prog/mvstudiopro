import { describe, expect, it } from "vitest";
import {
  MANHUA_LEARN_STAGE,
  appendManhuaLearnProgressLine,
  serializeManhuaLearnProgressWriter,
  buildManhuaLearnStartLines,
  buildManhuaLocalLearnPanelSteps,
  formatManhuaLearnEpisodeDetail,
  getManhuaLearnPipelineMeta,
  manhuaLearnStageLabelZh,
} from "./manhuaTemplateLearnPipeline";

describe("manhuaTemplateLearnPipeline", () => {
  it("exposes product meta matching series thresholds", () => {
    const meta = getManhuaLearnPipelineMeta();
    expect(meta.batchMin).toBe(1);
    expect(meta.batchMax).toBe(80);
    expect(meta.batchDefault).toBe(8);
    expect(meta.analysisMin).toBe(16);
    expect(meta.analysisTarget).toBe(20);
    expect(meta.stepsZh.length).toBeGreaterThanOrEqual(5);
    expect(meta.summaryZh).toMatch(/合集|打点|连续失败 8 集/);
  });

  it("formats episode details for panel", () => {
    expect(formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.download, 3)).toMatch(
      /第 3 集/,
    );
    expect(manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.list)).toMatch(/解析/);
  });

  it("appends progress lines with cap", () => {
    let lines = buildManhuaLearnStartLines({ channel: "cloud", title: "测" });
    for (let i = 0; i < 50; i++) {
      lines = appendManhuaLearnProgressLine(lines, MANHUA_LEARN_STAGE.download, `d${i}`, 12);
    }
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(lines[0]?.detailZh).toBeTruthy();
  });

  it("并行模型回执按到达顺序逐条写入，不互相覆盖", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const write = serializeManhuaLearnProgressWriter(async (_phase, detailZh) => {
      events.push(`start:${detailZh}`);
      if (detailZh === "A") await firstGate;
      events.push(`end:${detailZh}`);
    });

    const first = write(MANHUA_LEARN_STAGE.audio, "A");
    const second = write(MANHUA_LEARN_STAGE.audio, "B");
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("builds local fallback panel steps", () => {
    const steps = buildManhuaLocalLearnPanelSteps({
      reasonZh: "网路失败",
      cmd: "pnpm run manhua:template-learn -- --url x",
      title: "某剧",
    });
    expect(steps.some((s) => s.stage === MANHUA_LEARN_STAGE.local_ready)).toBe(true);
    expect(steps.some((s) => /剪贴板|终端/.test(s.detailZh))).toBe(true);
  });
});
