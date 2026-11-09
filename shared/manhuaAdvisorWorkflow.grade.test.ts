import { describe, expect, it } from "vitest";
import { creativeVoiceProductionSchema } from "./creativeVoiceProduction";
import { MANHUA_ADVISOR_WORKFLOW_HELP } from "./manhuaAdvisorWorkflow";
import { COLOR_GRADE_LUT_GROUPS } from "./colorGrade";

const ok = (v: unknown) => creativeVoiceProductionSchema.safeParse(v).success;

describe("顾问 edit 契约：grade / transitionSettings / 扩展转场", () => {
  it("新字段通过", () => {
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: { all: { lutId: "golden_hour_standard", color_temperature: 4500 } } })).toBe(true);
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: { clips: [{ saturation: 0.8 }, null], referenceClipIndex: 0, autoMatch: true } })).toBe(true);
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: null })).toBe(true);
    expect(ok({ action: "edit", operation: "transition", episode: 1, transitionSettings: { kind: "dissolve", durationSec: 1.2 } })).toBe(true);
    expect(ok({ action: "edit", operation: "transition", episode: 1, transition: "wipeleft" })).toBe(true);
    expect(ok({ action: "edit", operation: "transition", episode: 1, transition: "cut" })).toBe(true);
  });
  it("非法 lutId / 越界 / 缺参 / 字段错位拒绝", () => {
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: { all: { lutId: "../x.cube" } } })).toBe(false);
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: { all: { saturation: 5 } } })).toBe(false);
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: { all: { color_temperature: 500 } } })).toBe(false);
    expect(ok({ action: "edit", operation: "grade", episode: 1, grade: { all: { custom_filter: "drawtext" } } })).toBe(false);
    expect(ok({ action: "edit", operation: "grade", episode: 1 })).toBe(false);
    expect(ok({ action: "edit", operation: "transition", episode: 1, transitionSettings: { kind: "dissolve", durationSec: 3 } })).toBe(false);
    expect(ok({ action: "edit", operation: "transition", episode: 1, transitionSettings: { kind: "zoom", durationSec: 1 } })).toBe(false);
    expect(ok({ action: "edit", operation: "transition", episode: 1 })).toBe(false);
    expect(ok({ action: "edit", operation: "transition", episode: 1, transition: "fade", transitionSettings: { kind: "fade", durationSec: 1 } })).toBe(false);
    expect(ok({ action: "edit", operation: "trim", episode: 1, shotIndex: 1, inSec: 0, outSec: 1, grade: null })).toBe(false);
  });
  it("顾问提示列出 20 个预设 id 与中文标签、色温方向", () => {
    const presets = COLOR_GRADE_LUT_GROUPS.flatMap(g => g.presets);
    expect(presets).toHaveLength(20);
    for (const p of presets) expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain(`${p.id}=${p.label}`);
    expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain("数值越低越暖");
    expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain("edit(inspect/reorder/trim/transition/grade");
  });
});
