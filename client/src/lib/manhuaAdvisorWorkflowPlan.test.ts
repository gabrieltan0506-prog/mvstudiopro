import { describe, it, expect } from "vitest";
import {
  creativeVoiceProductionSchema,
  creativeVoiceProductionToolParameters,
} from "@shared/creativeVoiceProduction";
import {
  advisorWorkflowRevision,
  advisorWorkflowReceiptContext,
  buildAdvisorWorkflowQuestion,
  parseAdvisorWorkflowPlan,
} from "./manhuaAdvisorWorkflowPlan";

describe("顾问统一工作流契约", () => {
  it("场景检查允许先读清单，再按真实场景ID读取视角状态", () => {
    for (const action of [
      { action: "worldControl", operation: "inspect" },
      { action: "worldControl", operation: "inspect", assetId: "scene-1" },
      { action: "worldControl", operation: "inspect", assetId: "scene-1", clipId: "clip-1" },
    ]) expect(creativeVoiceProductionSchema.parse(action)).toEqual(action);
    expect(() => creativeVoiceProductionSchema.parse({ action: "worldControl", operation: "inspect", assetId: "scene-1", camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 50 } })).toThrow();
  });
  it.each([
    { action: "writer", operation: "configure", topic: "宫廷悬疑" },
    {
      action: "asset",
      operation: "select",
      anchorId: "actor-1",
      libraryId: "owned-1",
    },
    { action: "modelControl", operation: "rigSubmit", assetId: "model-1" },
    {
      action: "worldControl",
      operation: "exportFrame",
      assetId: "scene-1",
      clipId: "clip-1",
      camera: { position: [1, 2, 3], target: [0, 0, 1], fov: 50 },
    },
    { action: "generate", operation: "clip", episode: 1, blockId: "clip-1" },
    {
      action: "audio",
      operation: "generateDialogue",
      clipId: "clip-1",
      cueId: "cue-1",
    },
    {
      action: "audio",
      operation: "configureCue",
      clipId: "clip-1",
      cueId: "cue-1",
      patch: { startSec: 1, endSec: 3, volume: 0.8 },
    },
    {
      action: "scoring",
      operation: "configure",
      clipId: "clip-1",
      musicId: "adopted-1",
    },
    { action: "scoring", operation: "submit" },
    {
      action: "asset",
      operation: "configure",
      assetId: "owned-1",
      metadata: { labelZh: "人物甲", role: "character" },
    },
    {
      action: "asset",
      operation: "claim",
      assetId: "owned-1",
      anchorIds: ["actor-1"],
    },
    {
      action: "asset",
      operation: "primary",
      assetId: "owned-1",
      anchorId: "actor-1",
      duty: "identity",
    },
    {
      action: "modelControl",
      operation: "multiviewSubmit",
      assetId: "model-1",
    },
    { action: "edit", operation: "reorder", episode: 1, order: [2, 1, 3] },
    {
      action: "edit",
      operation: "trim",
      episode: 1,
      shotIndex: 1,
      inSec: 0.5,
      outSec: 3,
    },
    { action: "edit", operation: "transition", episode: 1, transition: "cut" },
    {
      action: "deliver",
      operation: "selectVersion",
      episode: 1,
      versionIndex: 0,
    },
    { action: "storyboardRecovery", operation: "recover", episode: 1 },
  ])("验证可执行操作 %j", action =>
    expect(creativeVoiceProductionSchema.safeParse(action).success).toBe(true)
  );

  it.each([
    { action: "edit", operation: "reorder", episode: 1, order: [1, 1] },
    {
      action: "edit",
      operation: "trim",
      episode: 1,
      shotIndex: 1,
      inSec: 3,
      outSec: 2,
    },
    { action: "edit", operation: "transition", episode: 1, transition: "wipe" },
    {
      action: "asset",
      operation: "configure",
      assetId: "owned-1",
      metadata: {},
    },
    {
      action: "asset",
      operation: "primary",
      assetId: "owned-1",
      anchorId: "actor-1",
    },
    { action: "writer", operation: "trial", topic: "未确认的配置" },
    { action: "writer", operation: "configure" },
    { action: "asset", operation: "select", anchorId: "actor-1" },
    { action: "generate", operation: "clip", episode: 1 },
    { action: "generate", operation: "retake", episode: 1, blockId: "clip-1" },
    {
      action: "generate",
      operation: "selectVersion",
      episode: 1,
      blockId: "clip-1",
    },
    { action: "audio", operation: "generateDialogue", clipId: "clip-1" },
    {
      action: "audio",
      operation: "inspect",
      clipId: "clip-1",
      patch: { volume: 0.2 },
    },
    {
      action: "audio",
      operation: "configureCue",
      clipId: "clip-1",
      cueId: "cue-1",
      patch: {},
    },
    {
      action: "audio",
      operation: "configureCue",
      clipId: "clip-1",
      cueId: "cue-1",
      patch: { volume: 2 },
    },
    {
      action: "audio",
      operation: "selectSource",
      clipId: "clip-1",
      cueId: "cue-1",
      sourceId: "owned",
      url: "https://foreign.test/audio",
    },
    { action: "scoring", operation: "submit", confirmPaid: true },
    { action: "scoring", operation: "configure", clipId: "clip-1" },
    { action: "worldControl", operation: "exportFrame", assetId: "scene-1" },
    {
      action: "worldControl",
      operation: "exportFrame",
      assetId: "scene-1",
      clipId: "clip-1",
      camera: { position: [1, 2], target: [0, 0, 0], fov: 50 },
    },
    { action: "deliver", operation: "export", episode: 1, clipIds: ["clip-1"] },
  ])("拒绝缺参数、跨操作字段或费用绕过 %j", action =>
    expect(creativeVoiceProductionSchema.safeParse(action).success).toBe(false)
  );

  it("Live工具声明覆盖同一schema的全部动作与参数", () => {
    const metadata = creativeVoiceProductionToolParameters();
    expect(metadata.properties.action.enum.sort()).toEqual(
      creativeVoiceProductionSchema.options
        .map(row => row.shape.action.value)
        .sort()
    );
    expect(metadata.properties.operation.enum).toEqual(
      expect.arrayContaining([
        "selectSource",
        "previewMix",
        "rigRestore",
        "exportFrame",
        "applyAdvice",
        "submit",
      ])
    );
    expect(metadata.properties.camera.properties.position.items.type).toBe(
      "NUMBER"
    );
    expect(metadata.properties.camera.properties.position.minItems).toBe(3);
    expect(JSON.stringify(metadata)).not.toContain("prefixItems");
    expect(metadata.properties).not.toHaveProperty("confirmPaid");
    expect(metadata.properties).not.toHaveProperty("url");
  });

  it("文字方案只允许一个真实动作，拒绝自动执行链与未知字段", () => {
    const plan = {
      kind: "workflow_operation_v1",
      summaryZh: "检查本段音轨",
      action: { action: "audio", operation: "inspect", clipId: "clip-1" },
    };
    expect(
      parseAdvisorWorkflowPlan(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``)
    ).toEqual(plan);
    expect(() =>
      parseAdvisorWorkflowPlan(
        JSON.stringify({ ...plan, actions: [plan.action] })
      )
    ).toThrow();
    expect(() =>
      parseAdvisorWorkflowPlan(
        JSON.stringify({
          ...plan,
          action: { action: "audio", operation: "trim", clipId: "clip-1" },
        })
      )
    ).toThrow();
    const question = buildAdvisorWorkflowQuestion(
      "给第一段配乐",
      '{"clips":[{"id":"clip-1"}]}'
    );
    expect(question).toContain("不自动串行生成");
    expect(question).toContain("scoring");
  });

  it("后续动作上下文保留任务编号但不转发素材地址", () => {
    const value = advisorWorkflowReceiptContext(
      JSON.stringify({
        jobId: "original-1",
        url: "https://owned.test/video?signature=hidden",
        gcsUri: "gs://owned/video",
        note: "原任务保留",
      })
    );
    expect(value).toContain("original-1");
    expect(value).not.toMatch(/https?:|gs:|signature/);
    expect(JSON.parse(value).note).toBe("原任务保留");
  });

  it("正文、采用版本或音轨变化会改变操作基线摘要", () => {
    const base = {
      episode: 1,
      blocks: [
        {
          id: "clip-1",
          outputUrl: "owned-old",
          audio: { selectedTakeId: "take-1" },
        },
      ],
    };
    expect(advisorWorkflowRevision(base)).toBe(
      advisorWorkflowRevision(structuredClone(base))
    );
    expect(advisorWorkflowRevision(base)).not.toBe(
      advisorWorkflowRevision({ ...base, episode: 2 })
    );
    expect(advisorWorkflowRevision(base)).not.toBe(
      advisorWorkflowRevision({
        ...base,
        blocks: [{ ...base.blocks[0], audio: { selectedTakeId: "take-2" } }],
      })
    );
    expect(advisorWorkflowRevision(base)).not.toContain("owned-old");
  });
});
