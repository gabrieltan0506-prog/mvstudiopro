import { describe, expect, it } from "vitest";
import { partitionTopicCoverPipelineFlowLog } from "./topicCoverPipelineDebugPartitions";

describe("partitionTopicCoverPipelineFlowLog", () => {
  it("splits chinese-direct and OpenAI image logs (no GPT54 bucket)", () => {
    const part = partitionTopicCoverPipelineFlowLog([
      "[管线·阶段顺序] 未启用 A/Deep Research Pro → 直接 B/中文直送封面指令",
      "[chineseStaging·cover] 中文直送 · 无 GPT 5.4 骨架提炼 · 确定性语境聚焦（防满屏）",
      "[步骤1·中文直送] 中文封面指令送像素链路 · 约 4611 字符",
      "[步骤1b] 无 GPT 5.4 提炼 · 中文主体直接进封面像素链路（chars=4611）",
      "[封面·像素] GPT-IMAGE-2（9:16）· OpenAI/OpenRouter（无 NB2）…",
      "[单帧·OpenAI] GPT-IMAGE-2 edit · 9:16 · size=1024x1536 · quality=high · 参考=1张",
      "[GPT-IMAGE-2·OpenAI] 成功 · https://example.com/x.png…",
      "✓ 本条结束：已得到 imageUrl",
      "[2×4·中文直送] 封面/分镜/八格均跳过英文化 · 中文主体 + 英文像素锁送 GPT-IMAGE-2",
      "[2×4·步骤2a·换脸主力] OpenAI/OpenRouter 成功 · 整链第 1/2 次",
    ]);

    expect(part.hints.phaseOrderLine).toMatch(/中文直送/);
    expect(part.chineseDirectLines.some((l) => /步骤1·中文直送/.test(l))).toBe(true);
    expect(part.chineseDirectLines.some((l) => /chineseStaging/.test(l))).toBe(true);
    expect(part.chineseDirectLines.some((l) => /2×4·中文直送/.test(l))).toBe(true);
    expect(part.imageGenLines.some((l) => /单帧·OpenAI/.test(l))).toBe(true);
    expect(part.imageGenLines.some((l) => /换脸主力/.test(l))).toBe(true);
    expect(part.hints.step1ChineseDirectDone).toBe(true);
    expect(part.hints.imageGenSuccess).toBe(true);
    expect(part.hints.gpt54LayerActivity).toBe(true); // alias
    expect(part.gpt54AndTranslationLines).toEqual(part.chineseDirectLines);
  });

  it("still buckets legacy GPT54 translation lines into B for old jobs", () => {
    const part = partitionTopicCoverPipelineFlowLog([
      "[Vertex·Flash] [骨架·中文视觉] extractChineseVisualBrief 開始",
      "[GPT54·英文化] 完成",
      "[英文化·完成] model=gpt-5.4 · 英文=1200字",
    ]);
    expect(part.chineseDirectLines.length).toBe(3);
    expect(part.imageGenLines.length).toBe(0);
  });
});
