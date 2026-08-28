import { describe, expect, it } from "vitest";
import {
  buildManhuaAssetsGapItems,
  buildManhuaAssetsGapZh,
  type ManhuaAssetsGapInput,
} from "./manhuaPhaseGapText";

/** 全齐基线：单测里按需拨缺口，避免每条用例重抄一遍输入 */
function baseInput(overrides: Partial<ManhuaAssetsGapInput> = {}): ManhuaAssetsGapInput {
  return {
    assetsComplete: false,
    gate: {
      missingCastIds: [],
      missingScene: false,
      sceneLocked: true,
      hintZh: null,
    },
    castTotal: 3,
    stylePackMissing: false,
    scriptStale: false,
    ...overrides,
  };
}

describe("阶段条资产缺口文案", () => {
  it("资产已齐 → 空串且无条目（complete 判定权在闸门，这里只闭嘴）", () => {
    const input = baseInput({ assetsComplete: true });
    expect(buildManhuaAssetsGapZh(input)).toBe("");
    expect(buildManhuaAssetsGapItems(input)).toEqual([]);
  });

  it("缺角色 + 风格包未填 → 定妆 x/y 同一本人数账，且各带微操锚点", () => {
    // 审查 P1 实锤修正：x/y 都是人数（喂闸门 5 人、缺 2 人 → 定妆 3/5），
    // 不再数画廊张数（主角脸+全身两张会把 x 数虚高）
    const input = baseInput({
      gate: { missingCastIds: ["c1", "c2"], missingScene: false, sceneLocked: true, hintZh: null },
      castTotal: 5,
      stylePackMissing: true,
    });
    expect(buildManhuaAssetsGapZh(input)).toBe("定妆 3/5 · 风格包未填（选填）");
    const items = buildManhuaAssetsGapItems(input);
    expect(items.map((i) => i.anchor)).toEqual(["cast", "style"]);
    expect(items.map((i) => i.jumpLabelZh)).toEqual(["去补角色", "去填风格包"]);
  });

  it("castTotal 异常小于缺数时以缺数为底，不出现负数或 0/2 这类倒挂", () => {
    const input = baseInput({
      gate: { missingCastIds: ["c1", "c2"], missingScene: false, sceneLocked: true, hintZh: null },
      castTotal: 0,
    });
    expect(buildManhuaAssetsGapZh(input)).toBe("定妆 0/2");
  });

  it("只剩选填缺口时必须退回闸门整句，选填缀在其后（审查 P1：选填不得遮蔽真拦路）", () => {
    // 场景：新项目没勾角色，闸门 missingCastIds 为空但 hintZh 才是真拦路话
    const input = baseInput({
      gate: {
        missingCastIds: [],
        missingScene: false,
        sceneLocked: true,
        hintZh: "请勾选至少一张人物参考",
      },
      stylePackMissing: true,
    });
    expect(buildManhuaAssetsGapZh(input)).toBe("请勾选至少一张人物参考 · 风格包未填（选填）");
  });

  it("场景两态分开说：未锁定是「未选场景」，锁定没图是「场景图未出」", () => {
    expect(
      buildManhuaAssetsGapZh(
        baseInput({
          gate: { missingCastIds: [], missingScene: false, sceneLocked: false, hintZh: null },
        }),
      ),
    ).toBe("未选场景");
    expect(
      buildManhuaAssetsGapZh(
        baseInput({
          gate: { missingCastIds: [], missingScene: true, sceneLocked: true, hintZh: null },
        }),
      ),
    ).toBe("场景图未出");
  });

  it("剧本过期 → 提示重出且不带跳转锚点（重出入口在横幅，不在阶段格）", () => {
    const input = baseInput({ scriptStale: true });
    expect(buildManhuaAssetsGapZh(input)).toBe("剧本已改，资产待重出");
    expect(buildManhuaAssetsGapItems(input)[0]?.anchor).toBeUndefined();
  });

  it("未齐但条目为空 → 退回闸门整句提示，再退「资产未齐」兜底", () => {
    expect(
      buildManhuaAssetsGapZh(
        baseInput({
          gate: { missingCastIds: [], missingScene: false, sceneLocked: true, hintZh: "请先确认剧本表" },
        }),
      ),
    ).toBe("请先确认剧本表");
    expect(buildManhuaAssetsGapZh(baseInput())).toBe("资产未齐");
  });
});
