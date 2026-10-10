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
    })
  ).rejects.toBe(err);
  expect(invoke).toHaveBeenCalledTimes(1);
});
