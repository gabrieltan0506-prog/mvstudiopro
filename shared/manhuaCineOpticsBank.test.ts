import { describe, expect, it } from "vitest";
import {
  appendManhuaClipEngineOptics,
  formatRecommendedCineOpticsLine,
  recommendManhuaCineOpticsFromText,
  stripManhuaClipEngineOpticsForUi,
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

  it("keeps optics out of stored clip inject; appends only for engine", () => {
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
    expect(withCam).not.toContain("光学·");
    expect(withCam).not.toMatch(/\d+mm/);
    expect(withCam).toMatch(/近景，平视，微推。$/m);
    const eng = appendManhuaClipEngineOptics(withCam);
    expect(eng).toMatch(/【引擎光学】\d+mm/);
    expect(stripManhuaClipEngineOpticsForUi(eng)).not.toMatch(/\d+mm/);

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
    expect(noCam).toMatch(/近景微动。$/m);
    expect(appendManhuaClipEngineOptics(noCam)).not.toMatch(/【引擎光学】/);
  });
});
