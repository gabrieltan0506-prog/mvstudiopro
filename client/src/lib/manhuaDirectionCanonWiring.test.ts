/**
 * 导演包接线：断言「最终送进模型的那串提示词」带导演法典块，不是断言编译函数返回值。
 * 五个出口：编剧扩写 / 铺段（story·beats·reverse·keyart）/ 已铺重写 / 段成片 / 质检。没选卡时一个字都不多。
 */
import { describe, expect, it } from "vitest";
import {
  applyFactoryPrefsToBlocks,
  buildEpisodeQualityExpectedContext,
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import { buildManhuaWriterExpandPrompt } from "@shared/manhuaWriterRoom";
import { buildManhuaDirectionCanonFromSelection, readManhuaDirectionCanonFromBlocks } from "@shared/manhuaDirectionCanonLibrary";
import { manhuaDirectionBlocksLeakInternalNames, resolveDirectorStyleBlocks } from "@shared/manhuaDirectionCanon";

const canon = buildManhuaDirectionCanonFromSelection({
  mainCardId: "parallel_action_editing",
  sceneOverrides: { action: { cardId: "relational_action_rhythm", stages: ["clip"] } },
})!;
const MARK = "【导演法典·v1·parallel_action_editing·";
const SELECT = "【导演法典选卡·v1·parallel_action_editing·action=relational_action_rhythm:clip】";
const BANNED = ["Nolan", "诺兰", "吴宇森", "Inception", "盗梦", "Woo"];
const noNames = (text: string) => BANNED.forEach((n) => expect(text, n).not.toContain(n));

function pipeline(withCanon: boolean) {
  const spawned = spawnManhuaDramaStudio({
    topic: "雨夜守护",
    episodeIndex: 1,
    videoModel: "seedance-2.5",
    includeDirectorCraft: true,
    directionCanon: withCanon ? canon : null,
  });
  const reverse = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!;
  const outputText = Array.from({ length: 12 }, (_, i) => `${i + 1}. 第 ${i + 1} 镜：墨屠护住阿菁`).join("\n");
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map((b) => (b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b)),
    spawned.edges,
    reverse.id,
  );
  const ready = expanded.blocks.map((b) => (b.id.startsWith("keyart-") ? { ...b, status: "done" as const, outputUrl: `https://example.com/${b.id}.jpg` } : b));
  const ensured = ensureManhuaFragmentClips(ready, expanded.edges, 1, { videoModel: "seedance-2.5" });
  const by = (prefix: string) => ensured.blocks.filter((b) => b.id.startsWith(prefix));
  return { spawned, ensured, story: by("story-")[0]!, beats: by("beats-")[0]!, reverse: by("reverse-")[0]!, keyarts: by("keyart-"), clips: by("clip-") };
}

describe("导演包接线：提示词真的带了导演法典", () => {
  it("编剧扩写 prompt 带 story 块；不传则没有", () => {
    const base = { topic: "雨夜守护", brief: "每集结尾留钩子", episodeCount: 3, videoModel: "seedance-2.5" };
    const withCanon = buildManhuaWriterExpandPrompt({ ...base, directionCanon: canon });
    const without = buildManhuaWriterExpandPrompt(base);
    expect(withCanon).toContain(MARK);
    expect(withCanon).toContain("剧本层：");
    expect(without).not.toContain("导演法典");
    noNames(withCanon);
  });

  it("铺段：story/beats/reverse/keyart 各带对应阶段块；选卡标记只在 story 与 beats；关键帧块不写运镜", () => {
    const p = pipeline(true);
    expect(p.story.prompt).toContain(MARK);
    expect(p.story.prompt).toContain("剧本层：");
    expect(p.story.prompt).toContain(SELECT);
    expect(p.beats.prompt).toContain("分镜层：");
    expect(p.beats.prompt).toContain(SELECT);
    expect(p.reverse.prompt).toContain("分镜层：");
    expect(p.reverse.prompt).not.toContain(SELECT);
    expect(p.keyarts.length).toBeGreaterThan(1);
    for (const k of p.keyarts) {
      expect(k.prompt).toContain("关键帧层：");
      expect(k.prompt).not.toContain("剧本层：");
    }
    const keyframeRules = resolveDirectorStyleBlocks(canon).keyframe.split("\n").filter((l) => l.startsWith("- "));
    expect(keyframeRules.length).toBeGreaterThan(0);
    for (const l of keyframeRules) expect(l).not.toMatch(/运镜|剪辑|切换/);
    for (const b of p.ensured.blocks) noNames(b.prompt);
    expect(manhuaDirectionBlocksLeakInternalNames(resolveDirectorStyleBlocks(canon), canon)).toEqual([]);
  });

  it("段成片提示词带 clip 单行（动作场副卡只盖 clip 段）；从已铺节点回读选卡，不靠调用方再传", () => {
    const p = pipeline(true);
    expect(p.clips.length).toBeGreaterThan(0);
    for (const c of p.clips) {
      const line = c.prompt.split("\n").find((l) => l.startsWith("【导演法典·v1·"));
      expect(line, c.id).toBeTruthy();
      expect(line).not.toContain("\n");
    }
    expect(readManhuaDirectionCanonFromBlocks(p.ensured.blocks)).toEqual(canon);
  });

  it("已铺节点同步设置：剥旧投影再加，重写两次不重复", () => {
    const p = pipeline(true);
    const once = applyFactoryPrefsToBlocks(p.ensured.blocks, { craftShotIds: [] });
    const twice = applyFactoryPrefsToBlocks(once, { craftShotIds: [] });
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    const story2 = twice.find((b) => b.id.startsWith("story-"))!;
    const key2 = twice.find((b) => b.id.startsWith("keyart-"))!;
    expect(count(story2.prompt, "剧本层：")).toBe(1);
    expect(count(story2.prompt, SELECT)).toBe(1);
    expect(count(key2.prompt, "关键帧层：")).toBe(1);
  });

  it("质检 expectedContext 带审查块（失效条件 + 明确不用）", () => {
    const ctx = buildEpisodeQualityExpectedContext({ clipPrompt: "x", segmentCount: 1, durationSec: 30, directionCanon: canon });
    expect(ctx).toContain("审查提示（仅供参考，不作硬门禁）");
    expect(ctx).toContain("失效条件——");
    noNames(ctx);
    expect(buildEpisodeQualityExpectedContext({ clipPrompt: "x", segmentCount: 1, durationSec: 30 })).not.toContain("导演法典");
  });

  it("没选导演包：五个出口一个字都不多（与旧行为等价）", () => {
    const p = pipeline(false);
    for (const b of p.ensured.blocks) expect(b.prompt, b.id).not.toContain("导演法典");
    expect(readManhuaDirectionCanonFromBlocks(p.ensured.blocks)).toBeNull();
    const rewritten = applyFactoryPrefsToBlocks(p.ensured.blocks, { craftShotIds: [] });
    for (const b of rewritten) expect(b.prompt, b.id).not.toContain("导演法典");
  });
});
