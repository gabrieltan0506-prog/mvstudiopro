import { describe, expect, it } from "vitest";
import {
  appendManhuaClipEngineOptics,
  stripManhuaClipEngineOpticsForUi,
} from "./manhuaCineOpticsBank";
import {
  formatManhuaAssetImageBindBlock,
  formatManhuaClipImageRoleBindLine,
  planManhuaClipSeedanceImageBind,
  buildManhuaAssetLockRegistry,
} from "./manhuaAssetLockRegistry";
import {
  formatWorkbenchSegmentClipInjectBlock,
  hydrateWorkbenchShotsWithSegmentDialogue,
  stripManhuaClipForbiddenBoards,
} from "./manhuaScriptWorkbench";
import { extractManhuaSegmentDialogueQuotes } from "./manhuaEpisodeSegmentPlan";
import {
  applyShotDialoguesFromText,
  MANHUA_DIALOGUE_SILENCE_TOKEN,
  upsertShotDialogueSection,
} from "./manhuaShotDialoguePersist";

describe("manhua clip prompt slim (Seedance skill style)", () => {
  it("writes second-axis with action/camera tracks, framing, scene+light lock", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      sceneHintZh: "雨夜回廊",
      sceneDetailZh: "湿石回廊，檐水滴落",
      paletteZh: "冷青主色，烛金辅",
      lightingCameraZh: "侧逆光压暗；中景推至近景",
      sceneTag: "@场景1",
      shots: [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景微推",
          actionZh: "@角色2 猛地抬头",
          dialogueZh: "从前说过的话，都不算数了？",
          emotionZh: "委屈",
          microExpressionZh: "眼眶发红",
          voiceToneZh: "压哭腔",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "@角色1 攥拳别开脸",
          dialogueZh: "是我对不住你。",
          emotionZh: "愧疚",
          microExpressionZh: "下颌绷紧",
        },
      ],
    });
    expect(text).toContain("【第1段·15s】雨夜回廊");
    expect(text).toContain("【场景锁】");
    expect(text).toContain("湿石回廊");
    expect(text).toContain("@场景1");
    expect(text).toContain("【光影·景别·氛围】");
    // 顺叙白描：不再是「动作轨迹：X。运镜轨迹：Y」字段表
    expect(text).not.toContain("动作轨迹：");
    expect(text).not.toContain("景别：");
    expect(text).toContain("说「从前说过的话，都不算数了？」");
    expect(text).toContain("说「是我对不住你。」");
    expect(text).not.toMatch(/古风服化参考|arch_|节拍防火墙|成片预演硬锁|\d+mm|快门/);
    expect(text).not.toMatch(/情绪：委屈｜微表情/);
  });

  it("hydrates missing dialogue from 可拍表", () => {
    const quotes = extractManhuaSegmentDialogueQuotes(
      "「把玉珏交出来。」「你再装傻。」",
    );
    const shots = hydrateWorkbenchShotsWithSegmentDialogue(
      [
        { index: 1, durationSec: 0, cameraZh: "近景", actionZh: "@角色2 逼近" },
        { index: 2, durationSec: 0, cameraZh: "中景", actionZh: "@角色1 后退" },
      ],
      quotes,
    );
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      shots,
    });
    expect(text).toContain("说「把玉珏交出来。」");
    expect(text).toContain("说「你再装傻。」");
  });

  it("单字说话人也会被剥离姓名并绑定角色，不把姓名重复进台词", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 10,
      shots: [
        { index: 1, durationSec: 0, cameraZh: "近景", actionZh: "甲抬头" },
      ],
      segmentDialogueLines: ["甲：「别过来。」"],
      speakerTagByNameZh: { 甲: "@角色1" },
    });
    expect(text).toContain('@角色1说「别过来。」');
    expect(text).not.toContain('说「甲：');
  });

  it("keeps every dialogue cue when a 30s segment has more lines than visual shots", () => {
    const dialogue = [
      "甲方：「第一句。」",
      "乙方：「第二句。」",
      "甲方：「第三句。」",
      "乙方：「第四句。」",
    ].join("");
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 30,
      shots: [
        { index: 1, durationSec: 0, cameraZh: "全景", actionZh: "甲方走近" },
        { index: 2, durationSec: 0, cameraZh: "中景", actionZh: "乙方抬头" },
        { index: 3, durationSec: 0, cameraZh: "近景", actionZh: "两人对视" },
      ],
      segmentDialogueLines: extractManhuaSegmentDialogueQuotes(dialogue),
      speakerTagByNameZh: { 甲方: "@角色1", 乙方: "@角色2" },
    });
    const positions = ["第一句", "第二句", "第三句", "第四句"].map((line) =>
      text.indexOf(line),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text).toContain("同一镜位续演");
    expect(text).toContain("@角色2说「第四句。」");
  });

  it("does not truncate nine real dialogue quotes before timeline compilation", () => {
    const source = Array.from({ length: 9 }, (_, index) => `「第${index + 1}句」`).join("");
    expect(extractManhuaSegmentDialogueQuotes(source)).toHaveLength(9);
  });

  it("does not resurrect a dialogue explicitly cleared by the user", () => {
    const shots = applyShotDialoguesFromText(
      [{ index: 1, durationSec: 0, cameraZh: "近景", actionZh: "角色抬头" }],
      upsertShotDialogueSection("", { 1: MANHUA_DIALOGUE_SILENCE_TOKEN }),
    );
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      shots,
      segmentDialogueLines: ["原剧本旧台词"],
    });
    expect(text).not.toContain("原剧本旧台词");
  });

  it("strips ancient boards; asset Image bind is id-only in prompt (no URL leak)", () => {
    expect(
      stripManhuaClipForbiddenBoards("正文\n【古风服化参考】arch_x 长文"),
    ).not.toMatch(/古风服化|arch_/);
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "hero",
          url: "https://cdn.example/hero.jpg",
          role: "character",
          source: "upload",
          labelZh: "少主",
        },
      ],
    });
    const bind = formatManhuaAssetImageBindBlock(reg);
    expect(bind).toContain("id=hero");
    expect(bind).not.toMatch(/https?:\/\/|cdn\.example/);
    const plan = planManhuaClipSeedanceImageBind({
      assetRows: [
        {
          tag: "@角色1",
          id: "hero",
          labelZh: "少主",
          path: "https://cdn.example/hero.jpg",
        },
      ],
      stillUrls: ["https://cdn.example/k.jpg"],
    });
    expect(plan.bindLineZh).toContain("少主@图片1");
    expect(plan.bindLineZh).not.toMatch(/https?:\/\//);
    expect(formatManhuaClipImageRoleBindLine(3)).toContain("@图片1、@图片2、@图片3");
  });

  it("engine optics stay out of UI", () => {
    const base =
      "【第1段·15s】雨夜回廊\n0–5s：@角色2，抬头，眼眶发红，说「拿着」。近景微推。";
    const eng = appendManhuaClipEngineOptics(base);
    expect(eng).toMatch(/【引擎光学】\d+mm/);
    expect(stripManhuaClipEngineOpticsForUi(eng)).not.toMatch(/\d+mm|引擎光学/);
  });
});
