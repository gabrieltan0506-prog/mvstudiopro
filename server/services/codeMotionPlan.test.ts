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

it("无图场景直接编排可见主体与动作；纯文字方案不得冒充场景", async () => {
  const sceneBrief: CodeMotionBrief = {
    ...brief,
    style: "scenes",
    images: [],
    request: "冬天喝下咖啡后周围变成春天",
    text: "瑞芯咖啡",
  };
  const scene = {
    heading: "从冬天到春天",
    body: "一杯入口，冬天变成春天。",
    duration: 15,
    direction: "人物将杯子举到嘴边，暖意向外扩散。",
    composition: {
      id: "sip",
      duration: 15,
      elements: [{ id: "brand", type: "text", text: "瑞芯咖啡" }],
    },
  };
  const invoke = vi
    .fn()
    .mockResolvedValue(
      result({ version: 1, summary: "只有标题", scenes: [scene] })
    );
  await expect(
    generateCodeMotionPlan(sceneBrief, {
      invoke: invoke as CodeMotionPlanDeps["invoke"],
      speechEnabled: () => false,
    })
  ).rejects.toThrow("不能用纯文字代替");
  invoke.mockReset().mockResolvedValue(
    result({
      version: 1,
      summary: "人物捧杯和暖意扩散",
      scenes: [
        {
          ...scene,
          composition: {
            ...scene.composition,
            elements: [
              ...scene.composition.elements,
              {
                id: "person",
                type: "path",
                points: [
                  [0, 0],
                  [0.1, 0.2],
                  [0.2, 0],
                ],
                transform: { x: 0.4, y: 0.5 },
              },
              {
                id: "cup",
                type: "shape",
                shape: "rect",
                width: 0.1,
                height: 0.1,
                keyframes: [
                  { at: 0, y: 0.6 },
                  { at: 3, y: 0.4 },
                ],
              },
            ],
          },
        },
      ],
    })
  );
  const value = await generateCodeMotionPlan(sceneBrief, {
    invoke: invoke as CodeMotionPlanDeps["invoke"],
    speechEnabled: () => false,
  });
  const output = JSON.parse(value.answer);
  expect(
    output.scenes[0].composition.elements.find(
      (element: { id: string }) => element.id === "cup"
    ).keyframes
  ).toHaveLength(2);
  const prompt = invoke.mock.calls[0][0].messages[0].content;
  expect(prompt).toContain("没有上传图片时先编排可生成的场景图");
  expect(prompt).toContain("composition必须兑现direction");
  expect(
    JSON.parse(invoke.mock.calls[0][0].messages[1].content).images
  ).toEqual([]);
});
