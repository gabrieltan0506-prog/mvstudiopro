import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(async () => {
  (globalThis as { React?: unknown }).React = await import("react");
});

/** 离线替身：useMutation 直接带一份已返回的建议，不发任何请求、不扣积分。 */
const state = vi.hoisted(() => ({ data: undefined as unknown, calls: 0 }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    canvasMusicMv: {
      adviseMontageGrade: { useMutation: () => ({ isPending: false, data: state.data, mutateAsync: async () => (state.calls++, state.data) }) },
    },
  },
}));

import { MontageGradeAdvice, montageAdviceParamsZh } from "../components/canvas/MontageGradeAdvice";
import { VideoGradePanel, montageIntentMarkers } from "../components/canvas/VideoGradePanel";
import { describeMontageJunction } from "./montageFinish";

const ADVICE = {
  requestId: "r1",
  advice: {
    segmentsNow: [],
    seams: [
      { atSec: 4.1, jump: true, intent: "unwanted", beforeZh: "暖", afterZh: "冷", fixZh: "后段色温往暖拉一点" },
      { atSec: 7, jump: true, intent: "intended", beforeZh: "暗", afterZh: "亮", fixZh: "无需处理" },
      { atSec: 9, jump: false, intent: "unwanted", beforeZh: "", afterZh: "", fixZh: "" },
    ],
    grades: [
      { fromSec: 0, toSec: 4, correction: { lutId: "golden_hour_subtle" }, reasonZh: "开场回忆，偏暖" },
      { fromSec: 4, toSec: 7, correction: { color_temperature: 8000, saturation: 0.8 }, reasonZh: "冲突段压冷" },
      { fromSec: 7, toSec: 10, correction: {}, reasonZh: "结尾回到自然色" },
    ],
    arcZh: "先暖后冷，结尾回到自然色。",
  },
  segments: [
    { startSec: 0, endSec: 4, lutId: "golden_hour_subtle" },
    { startSec: 4, endSec: 7, junctionIntent: "unwanted", color_temperature: 8000, saturation: 0.8 },
    { startSec: 7, endSec: 10, junctionIntent: "intended" },
  ],
  usedBy: { channel: "test-channel", model: "test-model-x", failuresZh: [] },
  evidencePrefix: "x",
};
const advice = (debugMode = false) =>
  renderToStaticMarkup(createElement(MontageGradeAdvice, { videoGsUri: "gs://test-only/out.mp4", durationSec: 10, onApply: () => {}, debugMode }));

describe("AI 调色建议结果：分段与接点意图画到时间轴，说明精简", () => {
  it("返回后画出建议分段时间轴与接点意图；预设显示中文名；理由单行截断", () => {
    state.data = ADVICE;
    const html = advice();
    expect(html).toContain('aria-label="建议分段时间轴"');
    expect(html.match(/data-range-track-segment=/g)).toHaveLength(3);
    expect(html).toMatch(/<span class="text-amber-200">不该跳 4\.0秒</);
    expect(html).toMatch(/<span class="text-emerald-200">剧情需要 7\.0秒</);
    expect(html.match(/data-range-track-marker=/g)).toHaveLength(2);
    // 建议时间轴只读：分界滑块隐藏
    expect(html).toContain("[&amp;_[data-range-track-handle]]:hidden");
    expect(html).toContain("建议分 3 段：先暖后冷，结尾回到自然色。");
    expect(html).toContain("暖阳黄昏 · 轻");
    expect(html).not.toContain("golden_hour_subtle");
    expect(html).toContain("饱和 0.8、色温 8000K");
    expect(html).toMatch(/class="[^"]*truncate[^"]*" title="冲突段压冷"/);
    // 只列会跳的接点：不该跳给修法，剧情需要的只说保留
    expect(html).toContain("后段色温往暖拉一点");
    expect(html).toContain("保留这处转变");
    expect(html).not.toContain("无需处理");
    expect(html).not.toContain("<table");
    expect(html).toContain("套用到草稿");
  });
  it("前台不显示模型与通道名；仅 debug 显示", () => {
    state.data = ADVICE;
    expect(advice()).not.toMatch(/test-model-x|test-channel|Gemini|Flash/);
    expect(advice(true)).toContain("test-channel · test-model-x");
    state.data = undefined;
    const idle = advice(true);
    expect(idle).toContain("AI 调色建议 · 20 积分");
    expect(idle).not.toMatch(/Gemini|Flash/);
  });
  it("渲染不触发调用（不扣积分）", () => {
    expect(state.calls).toBe(0);
  });
  it("参数摘要：未改动写「保持原样」", () => {
    expect(montageAdviceParamsZh({ startSec: 0, endSec: 1 })).toBe("保持原样");
    expect(montageAdviceParamsZh({ startSec: 0, endSec: 1, lutId: "no_such", exposure: 0.2 })).toBe("预设、曝光 0.2");
  });
});

describe("调色面板时间轴与接点口径", () => {
  it("有分段才出时间轴；每个内部分界一个 slider，数字输入与 aria-label 保留", () => {
    const none = renderToStaticMarkup(createElement(VideoGradePanel, { value: { all: { saturation: 1.2 } }, onChange: () => {}, outputSec: 9 }));
    expect(none).not.toContain("分段时间轴");
    const html = renderToStaticMarkup(
      createElement(VideoGradePanel, {
        value: { segments: [{ startSec: 0, endSec: 3 }, { startSec: 3, endSec: 6, junctionIntent: "unwanted" }, { startSec: 6, endSec: 9, junctionIntent: "intended" }] },
        onChange: () => {},
        outputSec: 9,
      })
    );
    expect(html).toContain('aria-label="分段时间轴"');
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-label="第2段与第3段的分界"[^>]*aria-valuemin="3.1" aria-valuemax="8.9" aria-valuenow="6"/);
    for (const label of ["第1段开始秒", "第1段结束秒", "第3段结束秒", "第2段调色预设", "第2段饱和度", "第3段色温", "段间过渡秒数", "自动修正接点", "添加调色分段"]) expect(html).toContain(`aria-label="${label}"`);
    // 窄屏不挤行：滑杆独占一行（名称与数值在上一行），数字框与标签成组换行
    expect(html).toMatch(/<input aria-label="第2段饱和度" type="range"[^>]*class="block w-full"/);
    expect(html).toMatch(/class="flex flex-wrap gap-x-3 gap-y-1"><label class="flex items-center gap-1">开始秒<input aria-label="第1段开始秒" type="number"/);
    expect(html).toContain("进入本段：不该跳");
    expect(html).toContain("进入本段：剧情需要");
    expect(html).not.toMatch(/Gemini|Flash/);
  });
  it("不首尾相接时照实画出空档并给校验提示", () => {
    const html = renderToStaticMarkup(
      createElement(VideoGradePanel, { value: { segments: [{ startSec: 0, endSec: 3 }, { startSec: 4, endSec: 9 }] }, onChange: () => {}, outputSec: 10 })
    );
    expect(html).toMatch(/data-range-track-segment="1"[^>]*left:44\.4444%;width:55\.5556%/);
    expect(html).toContain("第1段与第2段之间有空档，采用前请修正");
  });
  it("意图标记", () => {
    expect(montageIntentMarkers([{ startSec: 0, junctionIntent: "unwanted" }, { startSec: 3 }, { startSec: 6, junctionIntent: "intended" }])).toEqual([{ sec: 6, label: "剧情需要", tone: "ok" }]);
  });
  it("接点口径：达标 / 不该跳未修平 / 未标注 / 剧情需要，各带差多少与怎么办", () => {
    const j = (delta: Partial<Record<"YAVG" | "UAVG" | "VAVG" | "SATAVG", number>>, rest: { pass?: boolean; autoCorrected?: boolean; intent?: "intended" | "unwanted" | null }) => ({
      atSec: 4, delta: { YAVG: 0, UAVG: 0, VAVG: 0, SATAVG: 0, ...delta }, pass: false, autoCorrected: false, intent: null, ...rest,
    });
    expect(describeMontageJunction(j({ YAVG: 1 }, { pass: true }), 2)).toEqual({ kind: "pass", labelZh: "达标", overZh: [], adviceZh: "" });
    expect(describeMontageJunction(j({}, { pass: true, autoCorrected: true }), 2).labelZh).toBe("达标（已自动修正）");
    const fix = describeMontageJunction(j({ YAVG: -8.24, UAVG: -4, SATAVG: 6 }, { intent: "unwanted" }), 3);
    expect(fix.kind).toBe("fix");
    expect(fix.labelZh).toBe("不该跳 · 未修平");
    expect(fix.overZh).toEqual(["亮度变暗 8.2（允许 5）", "色偏偏黄 4（允许 3）", "饱和度变浓 6（允许 5）"]);
    expect(fix.adviceZh).toBe("勾选「自动修正接点」重新生成；仍不平就调大「段间过渡秒数」，或手动微调第3段的对比度（明暗）、色温、饱和度，让它靠近前一段。");
    const still = describeMontageJunction(j({ VAVG: -3.5 }, { intent: "unwanted", autoCorrected: true }), 2);
    expect(still.labelZh).toBe("不该跳 · 自动修正后仍未修平");
    expect(still.overZh).toEqual(["色偏偏青 3.5（允许 3）"]);
    expect(still.adviceZh).toMatch(/^调大「段间过渡秒数」，或手动微调第2段的色温/);
    expect(describeMontageJunction(j({ YAVG: 9 }, { intent: "intended" }), 2)).toMatchObject({ kind: "story", labelZh: "剧情需要", adviceZh: "这里是剧情需要的转变，已保留，不用处理。" });
    expect(describeMontageJunction(j({ YAVG: 9 }, {}), 2)).toMatchObject({ kind: "unmarked", labelZh: "未标注是否该跳" });
    // 多轮自动修正的结构化警告：试了几轮、为什么停
    const warned = (reason: "max_rounds" | "too_short" | "no_step" | "not_attempted", rounds: number) => describeMontageJunction({ ...j({ YAVG: 7 }, {}), warning: { rounds, maxRounds: 3, reason } }, 4);
    expect(warned("max_rounds", 3)).toMatchObject({ kind: "fix", labelZh: "不该跳 · 自动修正 3 轮仍未修平", overZh: ["亮度变亮 7（允许 5）"] });
    expect(warned("max_rounds", 3).adviceZh).toMatch(/^调大「段间过渡秒数」，或手动微调第4段的对比度（明暗）/);
    expect(warned("no_step", 2).labelZh).toBe("不该跳 · 自动修正 2 轮后已修不动");
    expect(warned("no_step", 0).labelZh).toBe("不该跳 · 自动修正修不动");
    expect(warned("too_short", 0)).toMatchObject({ kind: "fix", labelZh: "不该跳 · 这一段太短，没法自动修平" });
    expect(warned("too_short", 0).adviceZh).toMatch(/^把第4段拉长一些/);
    expect(warned("not_attempted", 0)).toMatchObject({ kind: "fix", labelZh: "不该跳 · 未修平" });
    expect(warned("not_attempted", 0).adviceZh).toMatch(/^勾选「自动修正接点」重新生成/);
  });
});
