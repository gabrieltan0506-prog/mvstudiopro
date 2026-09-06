import { describe, expect, it } from "vitest";
import { buildManhuaAssembleSubtitleSource } from "./manhuaAssembleSubtitleSource";
import { defaultCanvasBlock } from "./canvasTypes";
import { upsertShotDialogueSection, MANHUA_DIALOGUE_SILENCE_TOKEN } from "@shared/manhuaShotDialoguePersist";
import { collectManhuaAssembleClipsFromDock } from "./manhuaProjectExport";
import { buildManhuaAssembleJobInput } from "@shared/manhuaAssembleJobInput";
import { buildManhuaAssemblePlan } from "@shared/manhuaFinalAssemble";

describe("合成字幕真实生产者", () => {
  it("不以节点prompt或普通散文编造默认镜号与字幕", () => {
    const base = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01-test", episodeIndex: 1,
      prompt: "1. 待生成镜头" };
    expect(buildManhuaAssembleSubtitleSource([base], 1, 1)).toBeUndefined();
    expect(buildManhuaAssembleSubtitleSource([{ ...base, outputText: "只有散文" }], 1, 1)).toBeUndefined();
  });
  it("当前集已生成正文及手改对白穿过坞→JSON→实际合成计划，其他集不串入", () => {
    const beats = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01-test", episodeIndex: 1,
      outputText: upsertShotDialogueSection("1. 推门\n2. 回望\n3. 停住", { 1: "不许走", 2: MANHUA_DIALOGUE_SILENCE_TOKEN, 3: "我等你" }) };
    const video = { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01-test", episodeIndex: 1, prompt: "已编译运镜", outputUrl: "https://test.invalid/source.mp4" };
    const source = buildManhuaAssembleSubtitleSource([beats, video], 1, 1, video.prompt);
    expect(source?.shots.map(shot => shot.textZh)).toEqual(["不许走", "", "我等你"]);
    expect(buildManhuaAssembleSubtitleSource([beats, video], 2, 1)).toBeUndefined();
    const clips = collectManhuaAssembleClipsFromDock([{ blockId: video.id, stage: "clip", kind: "video", episodeIndex: 1, label: "段1", outputUrl: video.outputUrl,
      clipQuality: { status: "passed", checks: {} as never, failedKeys: [], summary: "", raw: "", attempts: 1, reviewedAt: "2026-09-06" } }], { blocks: [beats, video] });
    const input = JSON.parse(JSON.stringify(buildManhuaAssembleJobInput({ clips })));
    expect(input.params.billingContractVersion).toBe("manhua-assemble-v1");
    expect(buildManhuaAssemblePlan(input.params.clips).sceneVideos[0]?.subtitleSource).toEqual(source);
    beats.outputText = upsertShotDialogueSection("1. 新稿", { 1: "不覆盖已经冻结的旧稿" });
    expect(input.params.clips[0].subtitleSource.shots[0].textZh).toBe("不许走");
  });

  it("尾段按真实一镜取字幕，长镜续段不重复首段对白", () => {
    const table = [
      "| # | 秒位 | 景别·运镜 | 画面 | 台词字幕 | 音效配乐 |",
      "|---|---|---|---|---|---|",
      "| 1 | 0-20 | 固定机位 | 长镜动作 | 首句 | 环境声 |",
      "| 2 | 20-25 | 近景 | 回望 | 尾句 | 环境声 |",
    ].join("\n");
    const beats = {
      ...defaultCanvasBlock("text", 0, 0),
      id: "beats-e01-auto",
      episodeIndex: 1,
      outputText: table,
    };
    const video = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01-auto-test",
      episodeIndex: 1,
      videoModel: "seedance-2.0" as const,
      prompt: "已编译运镜",
      outputUrl: "https://test.invalid/source.mp4",
    };

    expect(buildManhuaAssembleSubtitleSource([beats, video], 1, 1)?.shots).toEqual([
      expect.objectContaining({ shotIndex: 1, durationSec: 10, textZh: "首句" }),
    ]);
    expect(buildManhuaAssembleSubtitleSource([beats, video], 1, 2)?.shots).toEqual([
      expect.objectContaining({ shotIndex: 1, durationSec: 10, textZh: "" }),
    ]);
    expect(buildManhuaAssembleSubtitleSource([beats, video], 1, 3)?.shots).toEqual([
      expect.objectContaining({ shotIndex: 2, durationSec: 5, textZh: "尾句" }),
    ]);
  });
});
