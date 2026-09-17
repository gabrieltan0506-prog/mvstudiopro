import { describe, expect, it } from "vitest";
import {
  PREVIS_ABANDON_AFTER_MS,
  parsePrevisMissingSince,
  previsAbandonable,
} from "./manhuaPrevisAbandon";

const NOW = 1_800_000_000_000;

describe("白模原编号放弃判据", () => {
  it("不是连续查不到（null）时永远不许放弃", () => {
    expect(previsAbandonable(null, NOW)).toBe(false);
  });

  it("差 1 毫秒不许放弃，刚好满十分钟才许（阈值写死，不拿被测对象自证）", () => {
    expect(previsAbandonable(NOW - PREVIS_ABANDON_AFTER_MS + 1, NOW)).toBe(false);
    expect(previsAbandonable(NOW - PREVIS_ABANDON_AFTER_MS, NOW)).toBe(true);
    // 反例对照：阈值就是 10 分钟，改小了下面这条会红
    expect(previsAbandonable(NOW - 9 * 60_000, NOW)).toBe(false);
    expect(PREVIS_ABANDON_AFTER_MS).toBe(600_000);
  });

  it("重挂载续算：存下来的时间戳解析回来，计时不从零开始", () => {
    const stored = String(NOW - PREVIS_ABANDON_AFTER_MS - 1);
    const resumed = parsePrevisMissingSince(stored, NOW);
    expect(resumed).toBe(NOW - PREVIS_ABANDON_AFTER_MS - 1);
    expect(previsAbandonable(resumed, NOW)).toBe(true);
  });

  it("脏值一律当没存过：空、非数字、零/负数、未来时间戳", () => {
    for (const raw of [null, undefined, "", "abc", "NaN", "0", "-1"]) {
      expect(parsePrevisMissingSince(raw, NOW)).toBeNull();
    }
    // 未来时间戳（用户改过系统时钟）不认，否则放弃按钮会立刻点亮
    expect(parsePrevisMissingSince(String(NOW + 1), NOW)).toBeNull();
    // 正例对照：刚刚才记下的时间戳照收，不是一律拒绝
    expect(parsePrevisMissingSince(String(NOW), NOW)).toBe(NOW);
  });
});
