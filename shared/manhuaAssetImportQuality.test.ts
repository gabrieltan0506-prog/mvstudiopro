import { describe, expect, it } from "vitest";
import { evaluateManhuaAssetImportQuality } from "./manhuaAssetImportQuality";

describe("evaluateManhuaAssetImportQuality", () => {
  it("隔离小图、超宽图和人物横向切片", () => {
    expect(
      evaluateManhuaAssetImportQuality({
        role: "scene",
        width: 180,
        height: 400,
      }).reviewStatus
    ).toBe("needs_review");
    expect(
      evaluateManhuaAssetImportQuality({
        role: "scene",
        width: 1200,
        height: 200,
      }).reviewStatus
    ).toBe("needs_review");
    expect(
      evaluateManhuaAssetImportQuality({
        role: "character",
        width: 652,
        height: 244,
      }).issues
    ).toContain("人物图为横向切片，需确认主体完整或标准化为竖版");
    expect(
      evaluateManhuaAssetImportQuality({
        role: "prop",
        width: 1672,
        height: 941,
      }).issues
    ).toContain("道具图疑似多件拼板，需确认或标准化后再锁定");
  });

  it("正常人物竖图与场景横图直接接纳", () => {
    expect(
      evaluateManhuaAssetImportQuality({
        role: "character",
        width: 1024,
        height: 1536,
      }).reviewStatus
    ).toBe("accepted");
    expect(
      evaluateManhuaAssetImportQuality({
        role: "scene",
        width: 1536,
        height: 1024,
      }).reviewStatus
    ).toBe("accepted");
  });
});
