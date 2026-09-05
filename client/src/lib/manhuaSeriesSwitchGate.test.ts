import { describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  confirmManhuaSeriesSwitchWithBackup,
  downloadManhuaSeriesSwitchBackup,
  inspectManhuaSeriesSwitchRisk,
  manhuaSeriesSwitchBackupConfirmZh,
  resolveManhuaBackupSeriesLabel,
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

  it("只有导演板状态也必须先备份", () => {
    const risk = inspectManhuaSeriesSwitchRisk({
      blocks: [],
      customAssetRefs: [],
      directorBoardMainByEpisode: { 1: { gcsUri: "gs://bucket/main.png" } },
      directorBoardBySegment: { 1: { 2: { gcsUri: "gs://bucket/seg.png" } } },
      directorBoardMotionOverlayBySegment: {},
    });
    expect(risk.needsBackup).toBe(true);
    expect(risk.directorBoardCount).toBe(2);
    expect(risk.summaryZh).toContain("导演板/轨迹 2 项");
  });

  it("把 final-eXX 计入当前工厂成片风险，忽略已归档历史块", () => {
    const active = defaultCanvasBlock("video", 0, 0);
    active.id = "final-e02";
    active.outputUrl = "https://example.com/final.mp4";
    const archived = defaultCanvasBlock("video", 0, 0);
    archived.id = "final-e01-archived";
    archived.outputUrl = "https://example.com/old.mp4";
    archived.archivedFromPreviousScript = true;

    const risk = inspectManhuaSeriesSwitchRisk({ blocks: [active, archived] });
    expect(risk.needsBackup).toBe(true);
    expect(risk.paidFactoryOutputCount).toBe(1);
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

  it("backup label prefers previous title and rejects incoming 正剧名", () => {
    expect(
      resolveManhuaBackupSeriesLabel({
        writerPack: {
          seriesTitle: "旧短剧",
          logline: "",
          charactersMd: "",
          propsMd: "",
          locationsMd: "",
          episodes: [],
          rawMarkdown: "x".repeat(80),
          episodeCount: 0,
        },
        topic: "雁门照山河",
        incomingSeriesTitle: "雁门照山河",
      }),
    ).toBe("旧短剧");
    expect(
      resolveManhuaBackupSeriesLabel({
        previousSeriesTitle: "先前专案甲",
        topic: "雁门照山河",
        incomingSeriesTitle: "雁门照山河",
      }),
    ).toBe("先前专案甲");
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

  it("任一备份项失败时不进入清空确认，也不报告备份成功", async () => {
    const confirmClear = vi.fn(() => true);
    const onBackupOk = vi.fn();
    const onBackupFail = vi.fn();
    const ok = await confirmManhuaSeriesSwitchWithBackup({
      risk: {
        seriesTitle: "旧短剧",
        hasWriterPack: false,
        paidSeriesAssetCount: 0,
        paidFactoryOutputCount: 1,
        customRefCount: 0,
        needsBackup: true,
        summaryZh: "旧专案",
      },
      download: vi.fn(async () => ({ filename: "partial.zip", okCount: 2, failCount: 1 })),
      confirmBackup: () => true,
      confirmClear,
      onBackupOk,
      onBackupFail,
    });
    expect(ok).toBe(false);
    expect(confirmClear).not.toHaveBeenCalled();
    expect(onBackupOk).not.toHaveBeenCalled();
    expect(onBackupFail).toHaveBeenCalledWith(expect.stringContaining("1 项失败"));
  });

  it("换剧备份真实传入 final 块并把所有版本写入工程包后才触发下载", async () => {
    const prevFetch = globalThis.fetch;
    const createdBlobs: Blob[] = [];
    const click = vi.fn();
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([3, 2, 1]), { status: 200 })) as typeof fetch;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error("测试只接受 Blob 下载");
      createdBlobs.push(blob);
      return `blob:test-${createdBlobs.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("document", {
      createElement: () => ({
        href: "",
        download: "",
        rel: "",
        click,
        remove: vi.fn(),
      }),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    const final = defaultCanvasBlock("video", 0, 0);
    final.id = "final-e01";
    final.episodeIndex = 1;
    final.outputUrl = "https://example.com/final-current.mp4";
    final.outputUrls = [
      "https://example.com/final-current.mp4",
      "https://example.com/final-old.mp4",
    ];

    try {
      const result = await downloadManhuaSeriesSwitchBackup({
        blocks: [final],
        previousSeriesTitle: "旧剧",
        incomingSeriesTitle: "新剧",
        askPreviousTitle: false,
      });
      expect(result.failCount).toBe(0);
      expect(result.okCount).toBe(2);
      expect(click).toHaveBeenCalledTimes(2);
      const JSZip = (await import("jszip")).default;
      const projectZip = await JSZip.loadAsync(await createdBlobs[0]!.arrayBuffer());
      expect(projectZip.file("ep01/final-v01.mp4")).toBeTruthy();
      expect(projectZip.file("ep01/final-v02.mp4")).toBeTruthy();
    } finally {
      globalThis.fetch = prevFetch;
      vi.unstubAllGlobals();
    }
  });
});
