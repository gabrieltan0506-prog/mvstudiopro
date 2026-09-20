import { getActionCameraRecipeById } from "./manhuaActionCameraRecipeBank";
import type { ManhuaPrevisSpec } from "./manhuaPrevis";

/** 既有穿越机配方的舞台预演；不用屏幕红蓝线推测场景深度。 */
export function previsCamerasFromActionRecipe(recipeId: string | undefined, durationSec: number, actors: ManhuaPrevisSpec["actors"]): ManhuaPrevisSpec["cameras"] | null {
  if (getActionCameraRecipeById(recipeId)?.trackMode !== "fpv" || !actors.length) return null;
  const x = actors.reduce((sum, actor) => sum + actor.start[0], 0) / actors.length;
  const y = actors.reduce((sum, actor) => sum + actor.start[1], 0) / actors.length;
  const target: [number, number, number] = [x, y, 1];
  // 高处俯冲、侧掠主体、拉升；终点与下一段起点同源。
  const points: [number, number, number][] = [[x - 5, y - 8, 8], [x - 3, y - 4, 2.5], [x + 3, y - 3, 2.5], [x + 5, y + 4, 7]];
  const times = [0, Math.round(durationSec * 24 / 3) / 24, Math.round(durationSec * 24 * 2 / 3) / 24, durationSec];
  return points.slice(0, -1).map((position, i) => ({ startSec: times[i], endSec: times[i + 1], position, endPosition: points[i + 1], target, lens: 24 }));
}
