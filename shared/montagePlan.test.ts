import { describe, expect, it } from "vitest";
import {
  montagePlanSchema,
  parseMontagePlan,
  remapMontageSubtitles,
  montageAnalysisInstruction,
} from "./montagePlan";
import { concatParamsSchema } from "../server/jobs/postProdInput";
const cut = {
  startSec: 2,
  endSec: 5,
  reason: "保留回答后停顿",
  evidence: "回答结束后人物看向门口",
};
export const fixture = {
  sourceDurationSec: 10,
  summary: "提问、回答、转身",
  sourceSrt: "1\n00:00:02,100 --> 00:00:04,500\n已经说完。\n",
  uncertainties: [],
  plans: [
    { title: "预告", kind: "trailer", rationale: "保留悬念", cuts: [cut] },
    {
      title: "短版",
      kind: "short",
      rationale: "保留回答",
      cuts: [{ ...cut, startSec: 0, endSec: 6 }],
    },
  ],
  creativeDirections: [
    { title: "听者视角", evidence: "门口反应", difference: "改由听者叙述" },
    {
      title: "事后回访",
      evidence: "回答后的停顿",
      difference: "围绕后果而非复刻对话",
    },
  ],
};
describe("剪辑方案契约", () => {
  it("保留证据并拒绝空方案、越界、重叠和半格式", () => {
    expect(parseMontagePlan(JSON.stringify(fixture)).plans).toHaveLength(2);
    expect(montagePlanSchema.safeParse({ ...fixture, plans: [] }).success).toBe(
      false
    );
    expect(
      montagePlanSchema.safeParse({ ...fixture, sourceDurationSec: 3 }).success
    ).toBe(false);
    expect(
      montagePlanSchema.safeParse({
        ...fixture,
        plans: fixture.plans.map(p => ({ ...p, cuts: [cut, cut] })),
      }).success
    ).toBe(false);
    expect(() => parseMontagePlan("完成了")).toThrow();
  });
  it("字幕按所有保留片段累积偏移，拒绝切断对白", () => {
    const raw =
      fixture.sourceSrt + "\n2\n00:00:07,000 --> 00:00:08,000\n后一句。\n";
    const result = remapMontageSubtitles(raw, [
      cut,
      { startSec: 6, endSec: 9 },
    ]);
    expect(result).toContain("00:00:00,100 --> 00:00:02,500");
    expect(result).toContain("00:00:04,000 --> 00:00:05,000");
    expect(() =>
      remapMontageSubtitles(raw, [{ startSec: 3, endSec: 9 }])
    ).toThrow("截断对白");
    expect(remapMontageSubtitles("", [cut])).toBe("");
  });
  it("单段走相同队列契约，同步字幕不能静默走转场旁路", () => {
    const input = {
      clips: ["gs://test/a.mp4"],
      trims: [{ startSec: 2, endSec: 5 }],
      subtitleSrt: "1\n00:00:00,000 --> 00:00:01,000\n你好",
    };
    expect(concatParamsSchema.parse(input).clips).toHaveLength(1);
    expect(
      concatParamsSchema.safeParse({
        ...input,
        transition: { kind: "fade", durationSec: 0.5 },
      }).success
    ).toBe(false);
    expect(
      concatParamsSchema.safeParse({
        ...input,
        clips: [...input.clips, ...input.clips],
        trims: [...input.trims, ...input.trims],
        transition: { kind: "fade", durationSec: 0.5 },
      }).success
    ).toBe(false);
  });
  it("原生分析明确完整音画、对白与音乐边界", () => {
    const instruction = montageAnalysisInstruction(45);
    expect(instruction).toContain("目标约45秒");
    expect(instruction).toContain("不自动删静音或压低BGM");
    expect(instruction).toContain("不得把本次分析称逐帧审片");
  });
});
