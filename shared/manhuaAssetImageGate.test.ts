import { describe, expect, it } from "vitest";
import {
  evaluateManhuaAssetImageGate,
  planManhuaAssetImageSpawns,
} from "./manhuaAssetImageGate";

describe("manhuaAssetImageGate", () => {
  it("requires cast + scene + images before ready", () => {
    const empty = evaluateManhuaAssetImageGate({});
    expect(empty.ready).toBe(false);
    expect(empty.hintZh).toContain("角色与场景");

    const castOnly = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07", "char_m_02"],
    });
    expect(castOnly.castLocked).toBe(true);
    expect(castOnly.ready).toBe(false);

    const both = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07", "char_m_02"],
      sceneId: "scene_04",
    });
    // scene_04 有示意封面时 ready；否则需 sceneplate
    expect(both.castLocked).toBe(true);
    expect(both.sceneLocked).toBe(true);
    expect(both.castImagesReady).toBe(true);
  });

  it("plans sceneplate when scene demo cover missing", () => {
    const plans = planManhuaAssetImageSpawns({
      characterIds: ["char_f_07"],
      sceneId: "scene_12",
      topic: "办公室谈判",
    });
    // 若该场景已有示意封面则可能无 plan；无封面则必有 sceneplate
    const gate = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07"],
      sceneId: "scene_12",
    });
    if (!gate.sceneImageReady) {
      expect(plans.some((p) => p.kind === "sceneplate")).toBe(true);
      expect(plans.find((p) => p.kind === "sceneplate")?.prompt).toContain("场景设定图");
    }
  });
});
