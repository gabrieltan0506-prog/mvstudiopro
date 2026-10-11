/** Duration drift is normalized by the production renderer, not rejected at adoption.
 * Nominal duration describes the timeline slot; actual duration describes source media.
 */
export function codeMotionVideoDurationMatches(actual: number, nominal: number): boolean {
  return Number.isFinite(actual) && actual > 0 &&
    Number.isFinite(nominal) && nominal >= 4 && nominal <= 30;
}
