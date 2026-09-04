import { describe, expect, it } from "vitest";
import { buildManhuaAssetImageEditPrompt } from "./manhuaAssetImageEdit";

describe("buildManhuaAssetImageEditPrompt", () => {
  it("保留用户修改要求并补齐资产编辑边界", () => {
    const prompt = buildManhuaAssetImageEditPrompt(
      "  去掉角，头部灰黑，身体咖啡色渐变到黑色，左眼戴暗红眼罩。  ",
    );
    expect(prompt).toContain("去掉角，头部灰黑，身体咖啡色渐变到黑色，左眼戴暗红眼罩。");
    expect(prompt).toContain("未被点名修改");
    expect(prompt).toContain("禁止新增文字");
  });

  it("空指令不生产可提交提示词", () => {
    expect(buildManhuaAssetImageEditPrompt("   ")).toBe("");
  });
});
