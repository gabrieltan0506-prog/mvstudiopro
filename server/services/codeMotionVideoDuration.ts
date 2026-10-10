/** Provider encoders may append a few frames or audio padding to a requested shot.
 * Keep nominal timeline duration and original bytes; never accept a short source.
 */
export const CODE_MOTION_VIDEO_OVERRUN_SEC = 0.1;
export function codeMotionVideoDurationMatches(actual: number, nominal: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(nominal) &&
    nominal >= 4 && nominal <= 5 && actual >= nominal - 0.001 &&
    actual <= nominal + CODE_MOTION_VIDEO_OVERRUN_SEC + 1e-6;
}
