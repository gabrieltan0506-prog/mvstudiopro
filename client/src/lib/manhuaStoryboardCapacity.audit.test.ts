import { describe, expect, it } from "vitest";
import {
  spawnManhuaDramaStudio,
  expandManhuaShotKeyartsAfterReverse,
  ensureManhuaFragmentClips,
  queuedManhuaKeyartBlocks,
  queuedManhuaClipBlocks,
} from "./canvasDramaStudio";
import {
  groupShotsIntoSegments,
  parseWorkbenchShotsFromText,
  parseManhuaClipTargetDurationSec,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";

const model = "seedance-2.0-mini";
const mark = (kind: string, i: number) =>
  `${kind}标记${String(i).padStart(2, "0")}终`;
function originals(totalSec: number): ManhuaWorkbenchShot[] {
  return Array.from({ length: 29 }, (_, i) => ({
    index: i + 1,
    durationSec: i < 28 ? 4 : totalSec - 112,
    cameraZh: mark("运镜", i + 1),
    actionZh: mark("动作", i + 1),
    dialogueZh: mark("对白", i + 1),
    microExpressionZh: mark("表演", i + 1),
  }));
}
function preserved(text: string, kind: string) {
  return Array.from({ length: 29 }, (_, i) => i + 1).filter(i =>
    text.includes(mark(kind, i))
  );
}

describe("原稿容量回归：取消固定六段后，真实编排不得丢镜", () => {
  it.each([130, 135])(
    "%s秒29镜保留每镜动作、对白、运镜、表演及完整源时长",
    totalSec => {
      const source = originals(totalSec);
      const before = JSON.stringify(source);
      const segments = groupShotsIntoSegments(source, {
        videoModel: model,
        segmentCount: 6,
      });
      const shots = segments.flatMap(segment => segment.shots);
      const text = JSON.stringify(shots);
      const summary = {
        originalShots: source.length,
        originalSeconds: totalSec,
        recutShots: shots.length,
        segmentSeconds: segments.map(segment => segment.durationSec),
        outputSeconds: segments.reduce(
          (sum, segment) => sum + segment.durationSec,
          0
        ),
        actionKept: preserved(text, "动作"),
        dialogueKept: preserved(text, "对白"),
        cameraKept: preserved(text, "运镜"),
        performanceKept: preserved(text, "表演"),
      };
      console.info("容量现状审计", JSON.stringify(summary));
      expect(new Set(shots.map(shot => shot.index)).size).toBe(29);
      expect(summary.actionKept).toHaveLength(29);
      expect(summary.dialogueKept).toHaveLength(29);
      expect(summary.cameraKept).toHaveLength(29);
      expect(summary.performanceKept).toHaveLength(29);
      expect(segments.at(-1)?.sourceEndSec).toBe(totalSec);
      expect(shots.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(totalSec);
      expect(summary.outputSeconds).toBeGreaterThanOrEqual(totalSec);
      expect(segments.every(segment => segment.durationSec <= 15)).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
    }
  );

  it.each([130, 135])(
    "%s秒原稿经真实解析、静帧展开与成片提示词编排完整进入队列",
    totalSec => {
      let cursor = 0;
      const table = [
        "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
        "|---|---|---|---|---|---|",
        ...originals(totalSec).map(shot => {
          const start = cursor;
          cursor += shot.durationSec!;
          return `| ${shot.index} | ${start}-${cursor} | ${shot.cameraZh} | ${shot.actionZh}，${shot.microExpressionZh} | ${shot.dialogueZh} | 环境声 |`;
        }),
      ].join("\n");
      const parsed = parseWorkbenchShotsFromText(table);
      expect(parsed).toHaveLength(29);
      expect(parsed.reduce((sum, shot) => sum + shot.durationSec!, 0)).toBe(
        totalSec
      );
      const spawned = spawnManhuaDramaStudio({
        topic: "容量审计",
        episodeIndex: 1,
        videoModel: model,
      });
      const reverse = spawned.blocks.find(block =>
        block.id.startsWith("reverse-")
      )!;
      const blocks = spawned.blocks.map(block =>
        block.id === reverse.id
          ? { ...block, outputText: table, status: "done" as const }
          : block
      );
      const expanded = expandManhuaShotKeyartsAfterReverse(
        blocks,
        spawned.edges,
        reverse.id,
        { videoModel: model }
      );
      const compiled = ensureManhuaFragmentClips(
        expanded.blocks,
        expanded.edges,
        1,
        { videoModel: model }
      );
      const keyarts = queuedManhuaKeyartBlocks(compiled.blocks, 1, model);
      const clips = queuedManhuaClipBlocks(compiled.blocks, 1, model);
      const text = clips.map(block => block.prompt).join("\n");
      const durations = clips.map(block =>
        parseManhuaClipTargetDurationSec(block.prompt)
      );
      console.info(
        "真实编排容量审计",
        JSON.stringify({
          originalSeconds: totalSec,
          parsedShots: parsed.length,
          keyarts: keyarts.length,
          clips: clips.length,
          durations,
          actionKept: preserved(text, "动作"),
          dialogueKept: preserved(text, "对白"),
          cameraKept: preserved(text, "运镜"),
          performanceInActionKept: preserved(text, "表演"),
        })
      );
      expect(keyarts).toHaveLength(29);
      expect(clips.length).toBeGreaterThan(6);
      expect(clips.at(-1)?.manhuaAutoSegment?.sourceEndSec).toBe(totalSec);
      expect(durations.every(value => value! > 0 && value! <= 15)).toBe(true);
      expect(preserved(text, "动作")).toHaveLength(29);
      expect(preserved(text, "对白")).toHaveLength(29);
      expect(preserved(text, "运镜")).toHaveLength(29);
      expect(preserved(text, "表演")).toHaveLength(29);
      expect(
        durations.reduce<number>((sum, value) => sum + (value || 0), 0)
      ).toBeGreaterThanOrEqual(totalSec);
      expect(preserved(text, "动作")).toContain(29);
    }
  );
});
