import { describe, expect, it } from "vitest";
import {
  MANHUA_KEYART_SLIM_SOFT_MAX,
  attachManhuaKeyartShotInject,
  buildManhuaKeyartSlimPrompt,
  estimateManhuaKeyartSlimPromptChars,
} from "./manhuaKeyartSlimPrompt";
import { OPENAI_IMAGE_PROMPT_HARD_MAX } from "./manhuaKeyartPromptCompact";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench";

/** 与 canvasRunBlock.formatCanvasUpstreamPrompt 上游段上限对齐（测算用） */
function estimateCanvasUpstreamMerged(basePrompt: string, upstreamTexts: string[]): string {
  const trimmed = basePrompt.trim();
  const texts = upstreamTexts.map((t) => t.trim()).filter(Boolean);
  if (!texts.length) return trimmed;
  const upstreamSection = texts
    .map((text, index) => `[上游 ${index + 1}]\n${text}`)
    .join("\n\n---\n\n")
    .slice(0, 12_000);
  return trimmed
    ? `${trimmed}\n\n【引用上游文本】\n${upstreamSection}`
    : `【引用上游文本】\n${upstreamSection}`;
}

const heavyShot = (index: number): ManhuaWorkbenchShot => ({
  index,
  durationSec: 5,
  cameraZh: "中景，平视，缓慢推进",
  actionZh: "双人对峙拔刀交锋，雨丝初落，石阶湿反光，递剑再夺回",
  dialogueZh: "今日一别",
  emotionZh: "压抑后爆发",
  voiceToneZh: "低沉",
  microExpressionZh: "眉心微蹙",
  keyframeRole: "key_action",
});

describe("manhuaKeyartSlimPrompt source sizes", () => {
  it("heavy prefs + shot stays far under 8k / 32k", () => {
    const core = buildManhuaKeyartSlimPrompt({
      artStyleId: "cg_drama",
      characterIds: ["char_f_01", "char_m_01", "char_f_02", "char_m_02"],
      sceneId: "scene_04",
      propIds: ["demo_prop_xianxia_sword", "demo_prop_business_fountain_pen"],
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
    });
    const full = attachManhuaKeyartShotInject(core, heavyShot(1));
    expect(full).toContain("【静帧·源头短包】");
    expect(full.length).toBeLessThan(MANHUA_KEYART_SLIM_SOFT_MAX);
    expect(full.length).toBeLessThan(OPENAI_IMAGE_PROMPT_HARD_MAX);
    // 同核换 12 镜：每镜仍远低于硬上限（克隆的是短核不是肥文）
    for (let i = 1; i <= 12; i++) {
      const p = attachManhuaKeyartShotInject(core, heavyShot(i));
      expect(p.length).toBeLessThan(MANHUA_KEYART_SLIM_SOFT_MAX);
    }
  });

  it("estimate helper matches builder", () => {
    const input = {
      artStyleId: "cg_drama" as const,
      characterIds: ["char_f_01"],
      sceneId: "scene_01",
    };
    expect(estimateManhuaKeyartSlimPromptChars(input)).toBe(
      buildManhuaKeyartSlimPrompt(input).length,
    );
  });
});

describe("image/video prompt size risk (post-slim)", () => {
  it("keyart image path: slim + noText + continuity << 32k", () => {
    const slim = attachManhuaKeyartShotInject(
      buildManhuaKeyartSlimPrompt({
        artStyleId: "cg_drama",
        characterIds: ["char_f_01", "char_m_01"],
        sceneId: "scene_04",
      }),
      heavyShot(3),
    );
    const noTextEn =
      "STRICT NO TEXT: pure cinematic still only. Zero readable letters...";
    const continuity =
      "【同集静帧一致性】与同集其他分镜保持人物身份、服装、场景材质与光色一致。";
    const imagePrompt = [slim, "【多图融合】另有 3 张参考图", noTextEn, continuity]
      .join("\n")
      .trim();
    expect(imagePrompt.length).toBeLessThan(6_000);
    expect(imagePrompt.length).toBeLessThan(OPENAI_IMAGE_PROMPT_HARD_MAX);
  });

  it("video clip path: upstream dump still caps at 12k — residual risk if reverse is huge", () => {
    // 成片仍走 formatCanvasUpstreamPrompt，会叠上游文本（最多 slice 12000）
    const clipBase = "【段成片】落实本段动作与运镜\n".repeat(40);
    const reverseDump = "反推分镜全文\n".repeat(2_000); // ~模拟超长反推
    const merged = estimateCanvasUpstreamMerged(clipBase, [reverseDump, "节拍表…"]);
    // 当前实现：上游段硬 slice(0,12000) + base
    expect(merged.length).toBeLessThan(clipBase.length + 12_500);
    // 风险结论：成片 prompt 仍可能到 ~1.5–1.6 万字级，但远低于静帧曾出现的 4 万；
    // Seedance 侧未见 32k 硬拒；若上游再肥，应另做成片短包（本 PR 先稳住静帧）。
    expect(merged.length).toBeLessThan(20_000);
  });
});
