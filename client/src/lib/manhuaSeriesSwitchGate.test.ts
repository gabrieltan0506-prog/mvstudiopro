import { describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  confirmManhuaSeriesSwitchWithBackup,
  inspectManhuaSeriesSwitchRisk,
  manhuaSeriesSwitchBackupConfirmZh,
} from "./manhuaSeriesSwitchGate";

describe("manhuaSeriesSwitchGate", () => {
  it("flags writer pack and paid series assets as needing backup", () => {
    const sheet = defaultCanvasBlock("image", 0, 0);
    sheet.id = "charsheet-hero";
    sheet.outputUrl = "https://example.com/a.jpg";
    const risk = inspectManhuaSeriesSwitchRisk({
      writerPack: {
        seriesTitle: "旧短剧",
        logline: "log",
        charactersMd: "主角",
        propsMd: "",
        locationsMd: "",
        episodes: [
          { index: 1, title: "一", body: "正文".repeat(20), endHook: "钩子未揭" },
          { index: 2, title: "二", body: "正文".repeat(20), endHook: "再留悬念" },
        ],
        rawMarkdown: "x".repeat(200),
        episodeCount: 2,
      },
      blocks: [sheet],
      customAssetRefs: [],
    });
    expect(risk.needsBackup).toBe(true);
    expect(risk.paidSeriesAssetCount).toBe(1);
    expect(manhuaSeriesSwitchBackupConfirmZh(risk)).toMatch(/付费生成|备份/);
  });

  it("aborts when user declines backup confirm", async () => {
    const ok = await confirmManhuaSeriesSwitchWithBackup({
      risk: {
        seriesTitle: "旧短剧",
        hasWriterPack: true,
        paidSeriesAssetCount: 1,
        paidFactoryOutputCount: 0,
        customRefCount: 0,
        needsBackup: true,
        summaryZh: "旧专案",
      },
      download: vi.fn(async () => ({ filename: "a.zip", okCount: 1, failCount: 0 })),
      confirmBackup: () => false,
    });
    expect(ok).toBe(false);
  });

  it("requires clear confirm after successful backup", async () => {
    const download = vi.fn(async () => ({ filename: "a.zip", okCount: 1, failCount: 0 }));
    const ok = await confirmManhuaSeriesSwitchWithBackup({
      risk: {
        seriesTitle: "旧短剧",
        hasWriterPack: true,
        paidSeriesAssetCount: 0,
        paidFactoryOutputCount: 0,
        customRefCount: 0,
        needsBackup: true,
        summaryZh: "旧专案",
      },
      download,
      confirmBackup: () => true,
      confirmClear: () => true,
    });
    expect(download).toHaveBeenCalledOnce();
    expect(ok).toBe(true);
  });
});
