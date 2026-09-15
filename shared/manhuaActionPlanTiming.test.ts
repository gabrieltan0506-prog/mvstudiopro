/**
 * 镜头时间映射：源时间 ↔ 呈现时间。
 *
 * 为什么单独一个测试文件：动作计划那边只断言外层 `timemap_invalid`，
 * 于是「去掉中间缺口检查、靠尾部检查兜住」这种退化改不了红——
 * 变异验证实测漏过（0915）。这里按 **issue code 逐条** 断言，一个检查一条用例。
 */
import { describe, expect, it } from "vitest";
import {
  fillManhuaShotTimeMap,
  manhuaPresentationDurationSec,
  manhuaPresentationToSourceSec,
  manhuaSnapToFrameSec,
  manhuaSourceToPresentationSec,
  validateManhuaShotTimeMap,
} from "./manhuaActionPlanTiming";

const codes = (map: Parameters<typeof validateManhuaShotTimeMap>[0]) =>
  validateManhuaShotTimeMap(map).map((i) => i.code);

describe("时间映射：校验逐条", () => {
  it("空 spans = 全程常速，合法", () => {
    expect(codes({ sourceDurationSec: 6, spans: [] })).toEqual([]);
  });

  it("完整覆盖的多段映射合法", () => {
    expect(
      codes({
        sourceDurationSec: 6,
        spans: [
          { sourceStartSec: 0, sourceEndSec: 2, rate: 1 },
          { sourceStartSec: 2, sourceEndSec: 4, rate: 0.5 },
          { sourceStartSec: 4, sourceEndSec: 6, rate: 1 },
        ],
      }),
    ).toEqual([]);
  });

  it("首尾颠倒或零长度 → span_reversed", () => {
    expect(
      codes({ sourceDurationSec: 6, spans: [{ sourceStartSec: 3, sourceEndSec: 1, rate: 1 }] }),
    ).toContain("span_reversed");
    expect(
      codes({ sourceDurationSec: 6, spans: [{ sourceStartSec: 2, sourceEndSec: 2, rate: 1 }] }),
    ).toContain("span_reversed");
  });

  it("超出源时长 → span_out_of_source", () => {
    expect(
      codes({ sourceDurationSec: 6, spans: [{ sourceStartSec: 0, sourceEndSec: 9, rate: 1 }] }),
    ).toContain("span_out_of_source");
  });

  it("区间重叠 → span_overlap", () => {
    expect(
      codes({
        sourceDurationSec: 6,
        spans: [
          { sourceStartSec: 0, sourceEndSec: 4, rate: 1 },
          { sourceStartSec: 3, sourceEndSec: 6, rate: 0.5 },
        ],
      }),
    ).toContain("span_overlap");
  });

  it("**开头留空** → span_gap（这一条独立于尾部检查，不能靠尾部兜）", () => {
    const found = codes({
      sourceDurationSec: 6,
      spans: [
        { sourceStartSec: 2, sourceEndSec: 6, rate: 0.5 }, // 0–2 秒没写
      ],
    });
    expect(found).toContain("span_gap");
    // 尾部是覆盖到的，所以这里绝不能出现尾部码——证明命中的确实是缺口检查
    expect(found).not.toContain("span_uncovered_tail");
  });

  it("**中间留空** → span_gap（同上，尾部已覆盖）", () => {
    const found = codes({
      sourceDurationSec: 6,
      spans: [
        { sourceStartSec: 0, sourceEndSec: 2, rate: 1 },
        { sourceStartSec: 4, sourceEndSec: 6, rate: 1 }, // 2–4 秒没写
      ],
    });
    expect(found).toContain("span_gap");
    expect(found).not.toContain("span_uncovered_tail");
  });

  it("**尾部留空** → span_uncovered_tail（与缺口分开，各测各的）", () => {
    const found = codes({
      sourceDurationSec: 6,
      spans: [{ sourceStartSec: 0, sourceEndSec: 4, rate: 1 }],
    });
    expect(found).toContain("span_uncovered_tail");
    expect(found).not.toContain("span_gap");
  });
});

describe("时间映射：源 ↔ 呈现", () => {
  const slowMiddle = {
    sourceDurationSec: 6,
    spans: [
      { sourceStartSec: 0, sourceEndSec: 2, rate: 1 },
      { sourceStartSec: 2, sourceEndSec: 4, rate: 0.5 }, // 2 秒源 → 4 秒呈现
      { sourceStartSec: 4, sourceEndSec: 6, rate: 1 },
    ],
  };

  it("2 秒动作 0.5 倍播放占 4 秒：呈现总长 8 秒而非 6 秒", () => {
    expect(manhuaPresentationDurationSec(slowMiddle)).toBeCloseTo(8, 6);
  });

  it("源 → 呈现：慢段中点映射正确", () => {
    expect(manhuaSourceToPresentationSec(slowMiddle, 0)).toBeCloseTo(0, 6);
    expect(manhuaSourceToPresentationSec(slowMiddle, 2)).toBeCloseTo(2, 6);
    expect(manhuaSourceToPresentationSec(slowMiddle, 3)).toBeCloseTo(4, 6);
    expect(manhuaSourceToPresentationSec(slowMiddle, 4)).toBeCloseTo(6, 6);
    expect(manhuaSourceToPresentationSec(slowMiddle, 6)).toBeCloseTo(8, 6);
  });

  it("呈现 → 源：与正向互为反函数", () => {
    for (const t of [0, 1, 2, 4, 6, 8]) {
      const src = manhuaPresentationToSourceSec(slowMiddle, t);
      expect(manhuaSourceToPresentationSec(slowMiddle, src)).toBeCloseTo(t, 6);
    }
  });

  it("快放同样成立：2 倍速让 6 秒源只占 3 秒", () => {
    const fast = {
      sourceDurationSec: 6,
      spans: [{ sourceStartSec: 0, sourceEndSec: 6, rate: 2 }],
    };
    expect(manhuaPresentationDurationSec(fast)).toBeCloseTo(3, 6);
  });

  it("越界输入被夹到端点，不返回 NaN", () => {
    expect(manhuaSourceToPresentationSec(slowMiddle, -5)).toBeCloseTo(0, 6);
    expect(manhuaSourceToPresentationSec(slowMiddle, 99)).toBeCloseTo(8, 6);
    expect(manhuaPresentationToSourceSec(slowMiddle, 99)).toBeCloseTo(6, 6);
  });
});

describe("时间映射：补齐与对帧", () => {
  it("fillManhuaShotTimeMap 显式补常速，且补完无 issue", () => {
    const filled = fillManhuaShotTimeMap({
      sourceDurationSec: 6,
      spans: [{ sourceStartSec: 2, sourceEndSec: 4, rate: 0.5 }],
    });
    expect(filled.spans).toHaveLength(3);
    expect(filled.spans[0]).toEqual({ sourceStartSec: 0, sourceEndSec: 2, rate: 1 });
    expect(filled.spans[2]).toEqual({ sourceStartSec: 4, sourceEndSec: 6, rate: 1 });
    expect(validateManhuaShotTimeMap(filled)).toEqual([]);
  });

  it("空 spans 补成一条整段常速", () => {
    const filled = fillManhuaShotTimeMap({ sourceDurationSec: 5, spans: [] });
    expect(filled.spans).toEqual([{ sourceStartSec: 0, sourceEndSec: 5, rate: 1 }]);
  });

  it("24fps 对帧", () => {
    expect(manhuaSnapToFrameSec(1.01)).toBeCloseTo(24 / 24 / 1, 6);
    expect(manhuaSnapToFrameSec(1 / 24 + 0.001)).toBeCloseTo(1 / 24, 6);
  });
});
