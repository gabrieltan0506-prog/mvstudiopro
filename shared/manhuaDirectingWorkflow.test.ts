import { describe, expect, it } from "vitest";
import {
  canContinueManhuaChain,
  compileManhuaDirectedSegmentPrompt,
  formatManhuaRetakeHintZh,
  manhuaContinuationRequiresLastFrame,
  stripManhuaPromptSlop,
  suggestManhuaRetakeVariable,
} from "./manhuaDirectingWorkflow";

describe("manhuaDirectingWorkflow", () => {
  it("strips cinematic slop", () => {
    const t = stripManhuaPromptSlop("电影感大片感，缓慢推进，侧逆光");
    expect(t).not.toMatch(/电影感|大片感/);
    expect(t).toContain("推进");
  });

  it("compiles beat firewall with intent", () => {
    const p = compileManhuaDirectedSegmentPrompt({
      segmentIndex: 2,
      intentZh: "压迫感逼近",
      thisBeatZh: "对白：「交出玉珏。」表演：握拳逼近",
      alreadyHappenedZh: "段1:初见试探",
      reservedForLaterZh: "段3:反杀",
    });
    expect(p).toContain("本段意图");
    expect(p).toContain("节拍防火墙");
    expect(p).toContain("勿重演");
    expect(p).toContain("留给后段");
  });

  it("gates continuation on last frame", () => {
    expect(manhuaContinuationRequiresLastFrame({}).ok).toBe(false);
    expect(
      manhuaContinuationRequiresLastFrame({
        acceptedClipUrl: "https://cdn.example/c.mp4",
      }).ok,
    ).toBe(true);
  });

  it("caps chain depth", () => {
    expect(canContinueManhuaChain({ sceneKey: "a", depth: 0 }).ok).toBe(true);
    expect(canContinueManhuaChain({ sceneKey: "a", depth: 2 }).ok).toBe(false);
  });

  it("suggests one-variable retake", () => {
    expect(suggestManhuaRetakeVariable("运镜抖动过大")).toBe("camera");
    expect(formatManhuaRetakeHintZh("performance", 1, 3)).toContain("表演");
  });
});
