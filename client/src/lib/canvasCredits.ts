export type CanvasImageBatchCount = 1 | 2 | 4;

export const CANVAS_IMAGE_BATCH_OPTIONS: Array<{ count: CanvasImageBatchCount; label: string }> = [
  { count: 1, label: "1 张" },
  { count: 2, label: "2 张九折" },
  { count: 4, label: "4 张八折" },
];
