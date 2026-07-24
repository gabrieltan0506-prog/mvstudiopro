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

describe("manhua clip prompt slim (Seedance skill style)", () => {
  it("writes compact second-axis: who/visible/action/say/camera — not chat forms", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      sceneHintZh: "雨夜回廊",
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
    expect(text).toContain(
      "0–7.5s：@角色2，猛地抬头，眼眶发红，说「从前说过的话，都不算数了？」。近景微推。",
    );
    expect(text).toContain(
      "7.5–15s：@角色1，攥拳别开脸，下颌绷紧，说「是我对不住你。」。中景。",
    );
    expect(text).not.toMatch(/场：|运镜：|动作：|表情：|对白：|衔接：/);
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
    expect(plan.bindLineZh).toContain("@角色1=@Image1");
    expect(plan.bindLineZh).not.toMatch(/https?:\/\//);
    expect(formatManhuaClipImageRoleBindLine(3)).toContain("@Image1、@Image2、@Image3");
  });

  it("engine optics stay out of UI", () => {
    const base =
      "【第1段·15s】雨夜回廊\n0–5s：@角色2，抬头，眼眶发红，说「拿着」。近景微推。";
    const eng = appendManhuaClipEngineOptics(base);
    expect(eng).toMatch(/【引擎光学】\d+mm/);
    expect(stripManhuaClipEngineOpticsForUi(eng)).not.toMatch(/\d+mm|引擎光学/);
  });
});
