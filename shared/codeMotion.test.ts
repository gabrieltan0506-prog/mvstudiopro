import { describe, expect, it } from "vitest";
import {
  codeMotionBriefSchema,
  codeMotionLocalProjectSchema,
  parseCodeMotionTable,
  compileCodeMotion,
  validateCodeMotionPlan,
  type CodeMotionBrief,
} from "./codeMotion";
const brief: CodeMotionBrief = {
  title: "新店介绍",
  request: "介绍真实特点",
  text: "欢迎光临",
  style: "words",
  duration: 30,
  orientation: "landscape",
  images: [],
  data: [],
  unit: "",
  chart: "bar",
  period: "",
  source: "",
};
const plan = {
  version: 1,
  summary: "先介绍，再说明",
  scenes: [
    { heading: "欢迎", body: "新店开业", duration: 15 },
    { heading: "来坐坐", body: "期待见面", duration: 15 },
  ],
};
describe("映刻受限方案", () => {
  it("文字编译为既有固定引擎，时间连续且总帧数不变", () => {
    const out = compileCodeMotion(brief, plan);
    expect(out.grammar).toBe("y5_kinetic_type");
    expect(out.cues.map(c => c.at)).toEqual([0, 15]);
    expect(out.duration * out.fps).toBe(900);
    expect(out.stageAnimation).toBeUndefined();
  });
  it("拒绝时长不闭合和模型注入代码", () => {
    expect(() =>
      validateCodeMotionPlan(brief, {
        ...plan,
        scenes: [{ heading: "一页", body: "", duration: 15 }],
      })
    ).toThrow("总时长");
    expect(() =>
      validateCodeMotionPlan(brief, { ...plan, script: "process.env" })
    ).toThrow();
  });
  it("拒绝不存在或遗漏的图片", () => {
    const image = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "原图.png",
      gcsUri: "gs://test-bucket/uploads/u1/test.png",
    };
    const b = { ...brief, style: "cards" as const, images: [image] };
    expect(() => validateCodeMotionPlan(b, plan)).toThrow("遗漏");
    expect(() =>
      validateCodeMotionPlan(b, {
        ...plan,
        scenes: [
          {
            ...plan.scenes[0],
            imageId: "22222222-2222-4222-8222-222222222222",
          },
          plan.scenes[1],
        ],
      })
    ).toThrow("未选择");
  });
  it("图表严格消费真实原数值，不允许模板默认数值", () => {
    const b = {
      ...brief,
      style: "data" as const,
      data: [
        { label: "甲", value: 17.25 },
        { label: "乙", value: 22 },
      ],
      unit: "万元",
      period: "本月",
      source: "本人统计",
    };
    const out = compileCodeMotion(b, {
      ...plan,
      scenes: [{ heading: "真实对比", body: "本月", duration: 30 }],
    });
    expect(out.data.series).toEqual(b.data);
    expect(out.data.suffix).toBe("万元");
    expect(() => codeMotionBriefSchema.parse({ ...b, data: [] })).toThrow(
      "真实数据"
    );
  });
  it("超长文档和未知资源不被静默截断", () => {
    expect(() =>
      codeMotionBriefSchema.parse({ ...brief, text: "字".repeat(4001) })
    ).toThrow();
    expect(() =>
      codeMotionBriefSchema.parse({ ...brief, url: "file:///etc/passwd" })
    ).toThrow();
  });
});

it("数据保留时间来源与六位精度，缺失值拒绝提交且允许本机恢复", () => {
  const b = {
    ...brief,
    style: "data" as const,
    chart: "line" as const,
    unit: "万元",
    period: "2026年",
    source: "本人账目",
    data: [
      { label: "一月", value: 0.000001 },
      { label: "二月", value: 0 },
    ],
  };
  const out = compileCodeMotion(b, {
    ...plan,
    scenes: [{ heading: "销售变化", body: "真实记录", duration: 30 }],
  });
  expect(out.data).toMatchObject({
    chart: "line",
    unit: "真实记录 · 2026年 · 万元",
    source: "本人账目",
    decimals: 6,
    series: b.data,
  });
  expect(out.cues[1].kind).toBe("line");
  const incomplete = {
    id: "11111111-1111-4111-8111-111111111111",
    brief: { ...b, request: "", data: [{ label: "", value: null }] },
    plan: null,
  };
  expect(codeMotionLocalProjectSchema.parse(incomplete)).toEqual(incomplete);
  expect(() =>
    codeMotionBriefSchema.parse({
      ...b,
      data: [
        { label: "一月", value: null },
        { label: "二月", value: 0 },
      ],
    })
  ).toThrow("缺失值");
  expect(() => codeMotionBriefSchema.parse({ ...b, source: "" })).toThrow(
    "来源"
  );
  expect(() =>
    codeMotionBriefSchema.parse({
      ...b,
      data: [
        { label: "甲", value: 0.1234567 },
        { label: "乙", value: 2 },
      ],
    })
  ).toThrow("六位小数");
});
it("两列表格完整读入，空白不变零、额外列及超量不截断", () => {
  expect(parseCodeMotionTable("项目\t数值\n甲\t12.5\n乙\t")).toEqual([
    { label: "甲", value: 12.5 },
    { label: "乙", value: null },
  ]);
  expect(() => parseCodeMotionTable("甲,1,000")).toThrow("两列");
  expect(() =>
    parseCodeMotionTable(
      Array.from({ length: 13 }, (_, i) => `项目${i}\t${i}`).join("\n")
    )
  ).toThrow("十二");
});
