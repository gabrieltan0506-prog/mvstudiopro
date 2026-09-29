/** 0929 用户定：对白长于秒窗时可按 0.5–2 倍调整语速（保持音高），派生新候选、需重新试听采用。 */
export const CANVAS_DIALOGUE_SPEED_MIN = 0.5;
export const CANVAS_DIALOGUE_SPEED_MAX = 2;
/** 超过这个倍速听感明显赶，界面提醒但不拦。 */
export const CANVAS_DIALOGUE_SPEED_WARN = 1.3;

const DERIVED_SUFFIX = /-x\d+p\d{2}\.wav$/i;

export function canvasDialogueSpeedObjectName(sourceObjectName: string, speed: number): string {
  return sourceObjectName.replace(/\.wav$/i, `-x${speed.toFixed(2).replace(".", "p")}.wav`);
}

export function isCanvasDialogueSpeedDerivedObject(objectName: string): boolean {
  return DERIVED_SUFFIX.test(objectName);
}

/**
 * 放进秒窗所需的倍速：向上取到 0.01，保证变速后不超窗；本来就放得下返回 null。
 * 超出 2 倍仍放不下时返回上限 2，并由调用方提示改时间窗。
 */
export function suggestCanvasDialogueSpeed(takeDurationSec: number, windowSec: number): { speed: number; fits: boolean } | null {
  // 容差与工作台「原声超出窗口」提示同为 0.02 秒：提示出现时必须同时给出可用倍速
  if (!(takeDurationSec > 0) || !(windowSec > 0) || takeDurationSec <= windowSec + 0.02) return null;
  const needed = Math.ceil((takeDurationSec / windowSec) * 100) / 100;
  return needed <= CANVAS_DIALOGUE_SPEED_MAX ? { speed: needed, fits: true } : { speed: CANVAS_DIALOGUE_SPEED_MAX, fits: false };
}
