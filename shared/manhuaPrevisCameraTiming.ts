import { z } from "zod";
/** 绝对秒窗：窗前保持起点，窗内平滑运动，窗后停在终点。 */
export const previsCameraWindowSchema = z.object({
  startSec: z.number().finite().min(0).max(30),
  endSec: z.number().finite().min(0).max(30),
}).strict();
export type PrevisCameraWindow = z.infer<typeof previsCameraWindowSchema>;
export function previsCameraProgress(shot: {startSec:number;endSec:number}, frame:number, window?:PrevisCameraWindow) {
  const start = Math.round((window ?? shot).startSec * 24) + 1;
  const end = Math.round((window ?? shot).endSec * 24);
  const u = Math.max(0, Math.min(1, (frame - start) / Math.max(1, end - start)));
  return u * u * (3 - 2 * u);
}
