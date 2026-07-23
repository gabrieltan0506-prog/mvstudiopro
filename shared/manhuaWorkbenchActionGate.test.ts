import { describe, expect, it } from "vitest";
import {
  explainManhuaClipActionGate,
  explainManhuaKeyartActionGate,
} from "./manhuaWorkbenchActionGate";

const readyGate = {
  castLocked: true,
  sceneLocked: true,
  castImagesReady: true,
  sceneImageReady: true,
  hintZh: null as string | null,
  missingCastIds: [] as string[],
};

describe("manhuaWorkbenchActionGate", () => {
  it("explains missing cast lock instead of silent block", () => {
    const msg = explainManhuaKeyartActionGate({
      outlineComplete: true,
      assetGate: { ...readyGate, castLocked: false, castImagesReady: false },
    });
    expect(msg).toMatch(/锁定人物/);
  });

  it("explains missing scene plate", () => {
    const msg = explainManhuaKeyartActionGate({
      outlineComplete: true,
      assetGate: {
        ...readyGate,
        sceneImageReady: false,
        hintZh: "请补主场景空镜",
      },
    });
    expect(msg).toMatch(/主场景空镜|场景/);
  });

  it("allows keyart when assets ready", () => {
    expect(
      explainManhuaKeyartActionGate({
        outlineComplete: true,
        assetGate: readyGate,
      }),
    ).toBeNull();
  });

  it("clip gate asks for keyarts when stills missing", () => {
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: false,
      visualBriefConfirmed: false,
    });
    expect(msg).toMatch(/关键静帧/);
  });
});
