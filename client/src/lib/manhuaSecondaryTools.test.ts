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

  it("对象在场的阶段归主操作簇：3D 归资产、白模与动作节奏归分镜、声音归分镜与成片", () => {
    expect(manhuaSecondaryToolHome("model3d", "assets")).toBe("cluster");
    expect(manhuaSecondaryToolHome("world3d", "assets")).toBe("cluster");
    expect(manhuaSecondaryToolHome("previs", "storyboard")).toBe("cluster");
    expect(manhuaSecondaryToolHome("actionTimeline", "storyboard")).toBe("cluster");
    expect(manhuaSecondaryToolHome("audio", "storyboard")).toBe("cluster");
    expect(manhuaSecondaryToolHome("audio", "edit")).toBe("cluster");
  });

  it("剧本阶段一个二级工具都不占主操作簇（那里既没有本段也没有模型）", () => {
    for (const tool of TOOLS) expect(manhuaSecondaryToolHome(tool, "outline")).toBe("drawer");
    expect(manhuaDrawerSecondaryTools("outline")).toEqual(TOOLS);
  });

  it("反例对照：3D 在分镜阶段不归簇、声音在资产阶段不归簇（否则等于没按对象过滤）", () => {
    expect(manhuaSecondaryToolHome("model3d", "storyboard")).toBe("drawer");
    expect(manhuaSecondaryToolHome("world3d", "storyboard")).toBe("drawer");
    expect(manhuaSecondaryToolHome("audio", "assets")).toBe("drawer");
    expect(manhuaDrawerSecondaryTools("assets")).toEqual(["previs", "actionTimeline", "audio"]);
    expect(manhuaDrawerSecondaryTools("storyboard")).toEqual(["model3d", "world3d"]);
  });

  it("抽屉里的顺序固定，不随阶段跳动；每个工具都有中文名", () => {
    expect(manhuaDrawerSecondaryTools("final")).toEqual(TOOLS);
    for (const tool of TOOLS) expect(MANHUA_SECONDARY_TOOL_LABEL_ZH[tool].length).toBeGreaterThan(1);
  });
});
