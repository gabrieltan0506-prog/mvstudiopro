import type { ManhuaCustomAssetRole } from "./manhuaCustomAssetRefs.js";

export type ManhuaAssetImportQualityResult = {
  reviewStatus: "accepted" | "needs_review";
  issues: string[];
};

/**
 * 免费结构检查只负责可证明的事实，不冒充人脸识别。
 * 人物横图通常是拼板误裁/半脸/纯背景，先隔离；用户确认或 AI 标准化后再进入锁脸。
 */
export function evaluateManhuaAssetImportQuality(input: {
  role: ManhuaCustomAssetRole | null;
  width: number;
  height: number;
}): ManhuaAssetImportQualityResult {
  const width = Math.max(0, Math.floor(Number(input.width) || 0));
  const height = Math.max(0, Math.floor(Number(input.height) || 0));
  const issues: string[] = [];
  if (!width || !height) issues.push("图片无法解码");
  if (Math.min(width, height) < 200) issues.push("短边小于 200px");
  if (width && height && Math.max(width / height, height / width) > 4)
    issues.push("长宽比超过 4:1");
  if (width * height > 40_000_000) issues.push("图片超过 4000 万像素");
  if (input.role === "character" && width > height * 1.15) {
    issues.push("人物图为横向切片，需确认主体完整或标准化为竖版");
  }
  if (input.role === "prop" && width > height * 1.5) {
    issues.push("道具图疑似多件拼板，需确认或标准化后再锁定");
  }
  return { reviewStatus: issues.length ? "needs_review" : "accepted", issues };
}
