import { describe, expect, it } from "vitest";
import { canvasDialogueSpeedObjectName, isCanvasDialogueSpeedDerivedObject, suggestCanvasDialogueSpeed } from "./canvasDialogueSpeed";

describe("对白语速建议", () => {
  it("放不下时向上取到 0.01 倍，保证变速后不超窗；放得下返回 null", () => {
    expect(suggestCanvasDialogueSpeed(6.144, 5)).toEqual({ speed: 1.23, fits: true });
    expect(6.144 / 1.23).toBeLessThanOrEqual(5);
    expect(suggestCanvasDialogueSpeed(5.02, 5)).toBeNull();
    expect(suggestCanvasDialogueSpeed(3, 5)).toBeNull();
  });
  it("2 倍仍放不下：返回上限并标记放不下", () => {
    expect(suggestCanvasDialogueSpeed(6.216, 1.5)).toEqual({ speed: 2, fits: false });
  });
  it("派生对象名与识别", () => {
    expect(canvasDialogueSpeedObjectName("post-prod/1/dialogue/dlg_a.wav", 0.5)).toBe("post-prod/1/dialogue/dlg_a-x0p50.wav");
    expect(isCanvasDialogueSpeedDerivedObject("post-prod/1/dialogue/dlg_a-x0p50.wav")).toBe(true);
    expect(isCanvasDialogueSpeedDerivedObject("post-prod/1/dialogue/dlg_a.wav")).toBe(false);
  });
});
