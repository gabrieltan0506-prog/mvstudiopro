import { expect, it, vi } from "vitest";
import {
  generateCodeMotionPlan,
  type CodeMotionPlanDeps,
} from "./codeMotionPlan";
import type { CodeMotionBrief } from "../../shared/codeMotion";
const brief: CodeMotionBrief = {
  title: "原图介绍",
  request: "温暖地介绍图片",
  text: "原文",
  style: "cards",
  duration: 15,
  orientation: "landscape",
  images: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "自己的图片.png",
      gcsUri: "gs://private/image.png",
    },
  ],
  data: [],
  unit: "",
  chart: "bar",
  period: "",
  source: "",
};
const plan = {
  version: 1,
  summary: "完整展示原图",
  scenes: [
    {
      heading: "欢迎",
      body: "原文",
      speech: { text: "原文", voice: "female" },
      duration: 15,
      imageId: brief.images[0].id,
    },
  ],
};
const result = (value: unknown) => ({
  choices: [{ message: { content: JSON.stringify(value) } }],
});
it("规划沿指定GLM→DeepSeek路线；模型只收到素材名字和ID", async () => {
  const invoke = vi
    .fn()
    .mockRejectedValueOnce(new Error("503"))
    .mockRejectedValueOnce(new Error("503"))
    .mockResolvedValueOnce(result(plan));
  const value = await generateCodeMotionPlan(brief, {
    invoke: invoke as CodeMotionPlanDeps["invoke"],
    speechEnabled: () => true,
  });
  expect(value.modelName).toBe("deepseek/deepseek-v4.1-flash");
  expect(JSON.parse(value.answer)).toEqual(plan);
  expect(invoke.mock.calls.map(c => c[0].modelName)).toEqual([
    "z-ai/glm-5.3-flashx",
    "glm-5.3-flashx",
    "deepseek/deepseek-v4.1-flash",
  ]);
  expect(JSON.stringify(invoke.mock.calls)).not.toContain("gs://private");
});
it("非法计划不得进入导出；重试次数有界", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue(
      result({ ...plan, scenes: [{ ...plan.scenes[0], duration: 4 }] })
    );
  await expect(
    generateCodeMotionPlan(brief, {
      invoke: invoke as CodeMotionPlanDeps["invoke"],
      speechEnabled: () => true,
    })
  ).rejects.toThrow("总时长");
  expect(invoke).toHaveBeenCalledTimes(4);
});

it("安全策略拦截不换模型继续生成", async () => {
  const err = Object.assign(new Error("内容被安全策略拦截"), {
    code: "sse_content_safety",
  });
  const invoke = vi.fn().mockRejectedValue(err);
  await expect(
    generateCodeMotionPlan(brief, {
      invoke: invoke as CodeMotionPlanDeps["invoke"],
      speechEnabled: () => true,
    })
  ).rejects.toBe(err);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("配音未开放时按无声安排，拒绝模型擅自合成", async () => {
  const silent = { ...plan, scenes: plan.scenes.map(({ speech, ...s }) => s) };
  const invoke = vi.fn().mockResolvedValue(result(silent));
  const value = await generateCodeMotionPlan(brief, {
    invoke: invoke as CodeMotionPlanDeps["invoke"],
    speechEnabled: () => false,
  });
  expect(JSON.parse(value.answer).scenes[0].speech).toBeUndefined();
  expect(
    JSON.parse(invoke.mock.calls[0][0].messages[1].content).speechEnabled
  ).toBe(false);
  invoke.mockResolvedValue(result(plan));
  await expect(
    generateCodeMotionPlan(brief, {
      invoke: invoke as CodeMotionPlanDeps["invoke"],
      speechEnabled: () => false,
    })
  ).rejects.toThrow("尚未开放");
});
