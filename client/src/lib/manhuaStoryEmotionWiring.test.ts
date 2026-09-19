/**
 * 0919 探针的核心发现：#1501+#1503+#1504 三张全合，`【本段戏核】`仍然不会出现在任何
 * 线上提示词里 —— `ensureManhuaFragmentClips` 的 5 个调用点没有一个传投影表。
 * 这一条是那条接线的回归：从「投影表 → ensure 入参 → 真实段提示词」整条走通，
 * 并验失效守卫（旧稿分析不喂下游）。
 */
import { describe, expect, it } from "vitest";
import {
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  queuedManhuaClipBlocks,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import {
  MANHUA_STORY_EMOTION_FORMAT,
  manhuaStoryEmotionIsStale,
  normalizeManhuaStoryEmotion,
  projectManhuaStoryEmotionForSegment,
} from "@shared/manhuaStoryEmotion";

const VIDEO_MODEL = "seedance-2.0-mini";

function preparedEpisode() {
  const spawned = spawnManhuaDramaStudio({ topic: "雨夜守护", episodeIndex: 1, videoModel: VIDEO_MODEL });
  const reverse = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!;
  const outputText = Array.from({ length: 18 }, (_, i) => `${i + 1}. 第 ${i + 1} 镜：墨屠护住阿菁`).join("\n");
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map((b) => (b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b)),
    spawned.edges,
    reverse.id,
  );
  const ready = expanded.blocks.map((b) =>
    b.id.startsWith("keyart-") ? { ...b, status: "done" as const, outputUrl: `https://example.com/${b.id}.jpg` } : b,
  );
  return { blocks: ready, edges: expanded.edges };
}

const analysis = normalizeManhuaStoryEmotion({
  format: MANHUA_STORY_EMOTION_FORMAT,
  scriptVersionKey: "v1",
  beats: [
    {
      id: "b1",
      episode: 1,
      segmentIndex: 1,
      characterZh: "墨屠",
      wantZh: "把阿菁带出雨巷",
      obstacleZh: "追兵堵住巷口",
      fromStateZh: "忍",
      triggerZh: "阿菁被拽住手腕",
      choiceZh: "拔刀",
      toStateZh: "翻脸",
      sourceZh: "第1段",
    },
  ],
  curve: [{ episode: 1, segmentIndex: 1, intensity: 8, kind: "turn", reasonZh: "逆鳞被碰" }],
  foreshadows: [],
  unreviewedZh: [],
});

/** 与 OmniCanvas 的 storyEmotionLineByEpisodeSegment 同口径（含失效守卫） */
function projectionOf(currentScriptVersionKey: string) {
  if (!analysis) return {};
  if (manhuaStoryEmotionIsStale(analysis, currentScriptVersionKey)) return {};
  const out: Record<number, Record<number, string>> = {};
  for (const point of analysis.curve) {
    const line = projectManhuaStoryEmotionForSegment(analysis, point.episode, point.segmentIndex);
    if (line) (out[point.episode] ||= {})[point.segmentIndex] = line;
  }
  return out;
}

describe("剧情情绪接线：投影表真的进了段成片提示词", () => {
  it("传了投影表，第1段提示词里出现【本段戏核】，内容就是投影出来那一行", () => {
    const { blocks, edges } = preparedEpisode();
    const projection = projectionOf("v1");
    const line = projection[1]![1]!;
    expect(line).toBeTruthy();
    const ensured = ensureManhuaFragmentClips(blocks, edges, 1, {
      videoModel: VIDEO_MODEL,
      storyEmotionLineByEpisodeSegment: projection,
    });
    const clips = queuedManhuaClipBlocks(ensured.blocks, 1, VIDEO_MODEL);
    const first = clips[0]!;
    expect(first.prompt).toContain("【本段戏核】");
    expect(first.prompt).toContain(line);
    // 位置：戏核在段头之后、秒轴之前（不许插到时间轴中间去）
    const headEnd = first.prompt!.indexOf("】");
    const coreAt = first.prompt!.indexOf("【本段戏核】");
    const timelineAt = first.prompt!.search(/0[–-]\d+s：/);
    expect(coreAt).toBeGreaterThan(headEnd);
    if (timelineAt >= 0) expect(coreAt).toBeLessThan(timelineAt);
    // 只喂了第1段，第2段不许被顶上同一行
    if (clips[1]) expect(clips[1].prompt).not.toContain(line);
  });

  it("反例对照：不传投影表时提示词里一个「本段戏核」都没有（这就是修之前的线上状态）", () => {
    const { blocks, edges } = preparedEpisode();
    const ensured = ensureManhuaFragmentClips(blocks, edges, 1, { videoModel: VIDEO_MODEL });
    const clips = queuedManhuaClipBlocks(ensured.blocks, 1, VIDEO_MODEL);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every((b) => !String(b.prompt || "").includes("【本段戏核】"))).toBe(true);
  });

  it("失效守卫：换过剧本（版本标识变了）时投影表为空，旧稿戏核不喂下游", () => {
    const stale = projectionOf("v2-换稿了");
    expect(stale).toEqual({});
    const { blocks, edges } = preparedEpisode();
    const ensured = ensureManhuaFragmentClips(blocks, edges, 1, {
      videoModel: VIDEO_MODEL,
      storyEmotionLineByEpisodeSegment: stale,
    });
    const clips = queuedManhuaClipBlocks(ensured.blocks, 1, VIDEO_MODEL);
    expect(clips.every((b) => !String(b.prompt || "").includes("【本段戏核】"))).toBe(true);
  });
});
