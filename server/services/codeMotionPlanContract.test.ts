import { expect, it, vi } from "vitest";
import { codeMotionBriefSchema } from "../../shared/codeMotion";
import {
  codeMotionPlanningContract,
  codeMotionPlanningResponseSchema,
  normalizeCodeMotionPlanTransforms,
} from "./codeMotionPlanContract";
import {
  generateCodeMotionPlan,
  type CodeMotionPlanDeps,
} from "./codeMotionPlan";
import {
  classifyCodeMotionPlanFailure,
  CodeMotionPlanError,
} from "./codeMotionPlanFailure";
const brief = codeMotionBriefSchema.parse({
  title: "咖啡",
  request: "冬天喝咖啡变春天",
  text: "",
  style: "words",
  duration: 30,
  orientation: "landscape",
  images: [],
  data: [],
  unit: "",
  period: "",
  source: "",
  chart: "bar",
});
const plan = {
  version: 1,
  summary: "冬天变春天",
  musicDirection: "钢琴由清冷短音过渡为温暖弦乐，结尾自然淡出",
  scenes: [{ heading: "春天", body: "温暖", duration: 30 }],
};
it("无音源合同仍允许真实待制作音乐方向，但拒绝伪造音源及错误画面模式", () => {
  const schema = codeMotionPlanningResponseSchema(brief);
  expect(schema.parse(plan).musicDirection).toBe(plan.musicDirection);
  expect(
    schema.safeParse({
      ...plan,
      audioTimeline: [{ sourceId: "bgm", role: "bgm", at: 0, duration: 30 }],
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      ...plan,
      scenes: [{ ...plan.scenes[0], composition: {} }],
    }).success
  ).toBe(false);
  expect(codeMotionPlanningContract(brief)).toContain("音乐模型真正生成");
});
it("只无损迁移根变换，不篡改0缩放或覆盖冲突值", () => {
  const input = {
    scenes: [
      {
        composition: {
          elements: [
            {
              id: "cup",
              x: 0.3,
              opacity: 0,
              keyframes: [{ at: 1, scaleX: 0 }],
            },
          ],
        },
      },
    ],
  };
  const result = normalizeCodeMotionPlanTransforms(input) as typeof input;
  expect(result.scenes[0].composition.elements[0]).toEqual({
    id: "cup",
    transform: { x: 0.3, opacity: 0 },
    keyframes: [{ at: 1, scaleX: 0 }],
  });
  expect(input.scenes[0].composition.elements[0].x).toBe(0.3);
  expect(() =>
    normalizeCodeMotionPlanTransforms({
      scenes: [
        { composition: { elements: [{ x: 0.3, transform: { x: 0.4 } }] } },
      ],
    })
  ).toThrow("冲突");
});
it("首次错误进入原有下一跳反馈，合法音乐意图完整传回供真实生成", async () => {
  const result = (p: unknown) => ({
    choices: [
      { message: { content: JSON.stringify(p) }, finish_reason: "stop" },
    ],
  });
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(
      result({ ...plan, audioTimeline: [{ sourceId: "invented" }] })
    )
    .mockResolvedValueOnce(result(plan));
  const value = await generateCodeMotionPlan(brief, {
    invoke: invoke as CodeMotionPlanDeps["invoke"],
  });
  expect(JSON.parse(value.answer).musicDirection).toBe(plan.musicDirection);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][0].messages.at(-1).content).toContain(
    "audioTimeline"
  );
});
it("诊断分类不泄漏上游正文与地址，终态保留安全原因", () => {
  const fail = classifyCodeMotionPlanFailure(
    new Error("secret https://private/token"),
    "request"
  );
  expect(fail.detailZh).not.toContain("secret");
  expect(
    classifyCodeMotionPlanFailure(new SyntaxError("secret"), "json").code
  ).toBe("invalid_json");
  expect(
    classifyCodeMotionPlanFailure(
      Object.assign(new Error("secret"), { status: 429 }),
      "request"
    ).code
  ).toBe("rate_limit");
  expect(new CodeMotionPlanError([fail]).message).toContain("模型调用失败");
});
