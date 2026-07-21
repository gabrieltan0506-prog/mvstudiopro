import { describe, expect, it } from "vitest";
import { normalizeManhuaShotCameraLanguage } from "./manhuaCameraLanguageZh";

describe("normalizeManhuaShotCameraLanguage", () => {
  it("translates leading English camera into cameraZh and strips from action", () => {
    const out = normalizeManhuaShotCameraLanguage({
      cameraZh: "全景，缓慢推近",
      actionZh:
        "Low angle, camera pushes in and pans fast. Woman hides letter in sleeve.",
    });
    expect(out.cameraZh).toMatch(/低角仰拍|推进|急摇/);
    expect(out.cameraZh).toMatch(/全景|缓慢推近/);
    expect(out.actionZh).not.toMatch(/Low angle|pushes in/i);
    expect(out.actionZh).toMatch(/Woman hides letter|letter in sleeve/);
  });

  it("handles over-the-shoulder tracking shot", () => {
    const out = normalizeManhuaShotCameraLanguage({
      cameraZh: "中近景，轻微横移",
      actionZh: "Over-the-shoulder tracking shot. Woman flips iron waist tag.",
    });
    expect(out.cameraZh).toMatch(/过肩跟拍/);
    expect(out.actionZh).not.toMatch(/Over-the-shoulder/i);
  });

  it("handles extreme close-up push in", () => {
    const out = normalizeManhuaShotCameraLanguage({
      cameraZh: "特写，微推",
      actionZh: "Extreme close-up push in. Woman reveals bloody portrait.",
    });
    expect(out.cameraZh).toMatch(/大特写/);
    expect(out.actionZh).not.toMatch(/Extreme close-up/i);
  });
});
