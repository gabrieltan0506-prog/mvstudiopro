import { describe, expect, it } from "vitest";
import {
  formatRecommendedCineOpticsLine,
  recommendManhuaCineOpticsFromText,
} from "./manhuaCineOpticsBank";
import { formatWorkbenchSegmentClipInjectBlock } from "./manhuaScriptWorkbench";

describe("manhuaCineOpticsBank", () => {
  it("maps 特写 from framing, not from example slogans", () => {
    const c = recommendManhuaCineOpticsFromText("特写，微推，锁住表情变化");
    expect(c?.focalMm).toBe(85);
    expect(c?.apertureF).toBe(1.8);
    expect(c?.dofZh).toMatch(/浅景深/);
  });

  it("maps 仰拍 without needing 气势仰拍 slogan", () => {
    const c = recommendManhuaCineOpticsFromText("低机位仰拍，缓慢上摇");
    expect(c?.focalMm).toBeLessThanOrEqual(28);
    expect(c?.nameZh).toMatch(/仰拍|广角/);
  });

  it("maps 跟拍/奔跑 to wider lens and motion shutter", () => {
    const c = recommendManhuaCineOpticsFromText("中景跟拍，人物奔跑穿过巷口");
    expect(c?.focalMm).toBe(35);
    expect(c?.shutterHintZh).toMatch(/1\/20/);
  });

  it("returns null when text has no camera/framing signal", () => {
    expect(recommendManhuaCineOpticsFromText("两人站着说话")).toBeNull();
    expect(recommendManhuaCineOpticsFromText("情绪崩溃泪落")).toBeNull();
    expect(formatRecommendedCineOpticsLine("随便聊聊天")).toBe("");
  });

  it("injects optics only when segment has 运镜/景别 cues", () => {
    const withCam = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      shots: [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景，平视，微推",
          actionZh: "低头不语",
        },
      ],
    });
    expect(withCam).toContain("光学·");
    expect(withCam).toMatch(/50mm/);

    const noCam = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 2,
      durationSec: 15,
      shots: [
        {
          index: 5,
          durationSec: 0,
          cameraZh: "",
          actionZh: "递出玉佩",
        },
      ],
    });
    // 无运镜信号时不应硬塞光学行
    expect(noCam).not.toContain("光学·");
  });
});
