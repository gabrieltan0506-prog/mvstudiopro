import { describe, expect, it } from "vitest";
import {
  canContinueManhuaChain,
  compileManhuaDirectedSegmentPrompt,
  formatManhuaRetakeHintZh,
  manhuaContinuationRequiresLastFrame,
  measureManhuaChainDepth,
  normalizeManhuaChainSceneKey,
  patchPromptForRetakeVariable,
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

  it("gates continuation preferring real last frame", () => {
    expect(manhuaContinuationRequiresLastFrame({}).ok).toBe(false);
    const byClip = manhuaContinuationRequiresLastFrame({
      acceptedClipUrl: "https://cdn.example/c.mp4",
    });
    expect(byClip.ok).toBe(true);
    expect(byClip.usedLastFrame).toBe(false);
    const byFrame = manhuaContinuationRequiresLastFrame({
      lastFrameUrl: "https://cdn.example/last.jpg",
      acceptedClipUrl: "https://cdn.example/c.mp4",
    });
    expect(byFrame.ok).toBe(true);
    expect(byFrame.usedLastFrame).toBe(true);
  });

  it("caps chain depth and measures by scene", () => {
    expect(canContinueManhuaChain({ sceneKey: "a", depth: 0 }).ok).toBe(true);
    expect(canContinueManhuaChain({ sceneKey: "a", depth: 2 }).ok).toBe(false);
    expect(normalizeManhuaChainSceneKey("雨夜 回廊")).toBe("雨夜回廊");
    const m = measureManhuaChainDepth({
      priorSceneKeys: ["雨夜回廊", "雨夜回廊", "偏殿"],
      nextSceneKey: "偏殿",
    });
    expect(m.depth).toBe(1);
    const same = measureManhuaChainDepth({
      priorSceneKeys: ["雨夜回廊", "雨夜回廊"],
      nextSceneKey: "雨夜回廊",
    });
    expect(same.depth).toBe(2);
    const afterReanchor = measureManhuaChainDepth({
      priorSceneKeys: ["雨夜回廊", "雨夜回廊"],
      nextSceneKey: "雨夜回廊",
      ignoreFirstN: 2,
    });
    expect(afterReanchor.depth).toBe(0);
  });

  it("suggests and patches one-variable retake", () => {
    expect(suggestManhuaRetakeVariable("运镜抖动过大")).toBe("camera");
    expect(formatManhuaRetakeHintZh("performance", 1, 3)).toContain("表演");
    const patched = patchPromptForRetakeVariable("缓慢推进，侧逆光", "lighting", 2);
    expect(patched).toContain("轻量重拍");
    expect(patched).toContain("光影");
    expect(patched).not.toMatch(/电影感/);
  });
});
