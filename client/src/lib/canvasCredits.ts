import type { CanvasImageModel } from "./canvasTypes";

export type CanvasImageBatchCount = 1 | 2 | 4;

/** Creative 页口径：Nano Banana 2 · 35；GPT-Image-2 · 54 */
const CANVAS_NANO_UNIT = 35;
const CANVAS_GPT_IMAGE_UNIT = 54;

/** 图片批量生成积分：1 张原价；2 张九折；4 张八折 */
export function canvasImageBatchTotalCredits(
  model: CanvasImageModel,
  count: CanvasImageBatchCount,
): number {
  const unit = model === "gpt-image-2" ? CANVAS_GPT_IMAGE_UNIT : CANVAS_NANO_UNIT;
  if (count === 1) return unit;
  if (count === 2) return Math.round(unit * 2 * 0.9);
  return Math.round(unit * 4 * 0.8);
}

/** 多图视觉分析预估（一次请求，含最多 50+ 张） */
export function canvasVisionTotalCredits(imageCount: number): number {
  if (imageCount <= 0) return 0;
  return imageCount <= 10 ? 60 : 60 + Math.ceil((imageCount - 10) / 10) * 15;
}

export const CANVAS_IMAGE_BATCH_OPTIONS: Array<{ count: CanvasImageBatchCount; label: string }> = [
  { count: 1, label: "1 张" },
  { count: 2, label: "2 张（九折）" },
  { count: 4, label: "4 张（八折）" },
];
