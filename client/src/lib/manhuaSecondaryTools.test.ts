import { describe, expect, it } from "vitest";
import {
  MANHUA_SECONDARY_TOOL_LABEL_ZH,
  manhuaDrawerSecondaryTools,
  manhuaSecondaryToolHome,
  type ManhuaSecondaryTool,
} from "./manhuaSecondaryTools";

const TOOLS: ManhuaSecondaryTool[] = ["model3d", "world3d", "previs", "actionTimeline", "audio"];
const PHASES = ["outline", "assets", "storyboard", "edit", "final"];

describe("二级工具的家", () => {
  it("任一阶段每个工具恰好一个家：不重复出现，也不会无处可去", () => {
    for (const phase of PHASES) {
      for (const tool of TOOLS) {
        const home = manhuaSecondaryToolHome(tool, phase);
        const inDrawer = manhuaDrawerSecondaryTools(phase).includes(tool);
        // 在簇里就不在抽屉里，在抽屉里就不在簇里
        expect(inDrawer).toBe(home === "drawer");
      }
    }
  });

  it("制作阶段的辅助工具也收进抽屉，不挤占当前主操作", () => {
    for (const phase of PHASES) {
      expect(manhuaDrawerSecondaryTools(phase)).toEqual(TOOLS);
      for (const tool of TOOLS) expect(manhuaSecondaryToolHome(tool, phase)).toBe("drawer");
    }
  });

  it("剧本阶段一个二级工具都不占主操作簇（那里既没有本段也没有模型）", () => {
    for (const tool of TOOLS) expect(manhuaSecondaryToolHome(tool, "outline")).toBe("drawer");
    expect(manhuaDrawerSecondaryTools("outline")).toEqual(TOOLS);
  });

  it("切换阶段不丢失辅助工具入口", () => {
    expect(manhuaSecondaryToolHome("model3d", "storyboard")).toBe("drawer");
    expect(manhuaSecondaryToolHome("world3d", "storyboard")).toBe("drawer");
    expect(manhuaSecondaryToolHome("audio", "assets")).toBe("drawer");
    expect(manhuaDrawerSecondaryTools("assets")).toEqual(TOOLS);
    expect(manhuaDrawerSecondaryTools("storyboard")).toEqual(TOOLS);
  });

  it("抽屉里的顺序固定，不随阶段跳动；每个工具都有中文名", () => {
    expect(manhuaDrawerSecondaryTools("final")).toEqual(TOOLS);
    for (const tool of TOOLS) expect(MANHUA_SECONDARY_TOOL_LABEL_ZH[tool].length).toBeGreaterThan(1);
  });
});
