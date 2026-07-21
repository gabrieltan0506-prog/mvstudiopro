import { describe, expect, it } from "vitest";
import {
  collectManhuaIdentityImageUrls,
  evaluateManhuaAssetImageGate,
  planManhuaAssetImageSpawns,
} from "./manhuaAssetImageGate";

describe("manhuaAssetImageGate", () => {
  it("B: library preview alone is not ready — needs charsheet/sceneplate or custom upload", () => {
    const empty = evaluateManhuaAssetImageGate({});
    expect(empty.ready).toBe(false);

    const castOnly = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07", "char_m_02"],
    });
    expect(castOnly.castLocked).toBe(true);
    expect(castOnly.castImagesReady).toBe(false);
    expect(castOnly.ready).toBe(false);

    const bothNoSheets = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07", "char_m_02"],
      sceneId: "scene_04",
    });
    expect(bothNoSheets.castLocked).toBe(true);
    expect(bothNoSheets.sceneLocked).toBe(true);
    expect(bothNoSheets.ready).toBe(false);
    expect(bothNoSheets.hintZh).toMatch(/设定卡|场景设定图/);
  });

  it("ready when charsheet + sceneplate media exist", () => {
    const gate = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07"],
      sceneId: "scene_04",
      assetBlocks: [
        { id: "charsheet-char_f_07", outputUrl: "https://cdn.example/sheet.jpg" },
        { id: "sceneplate-scene_04", outputUrl: "https://cdn.example/scene.jpg" },
      ],
    });
    expect(gate.ready).toBe(true);
    expect(gate.viaCustomUpload).toBe(false);
  });

  it("plans charsheet/sceneplate when missing", () => {
    const plans = planManhuaAssetImageSpawns({
      characterIds: ["char_f_07"],
      sceneId: "scene_12",
      topic: "办公室谈判",
    });
    expect(plans.some((p) => p.kind === "charsheet")).toBe(true);
    expect(plans.some((p) => p.kind === "sceneplate")).toBe(true);
  });

  it("custom tagged character+scene unlocks gate without library ids", () => {
    const gate = evaluateManhuaAssetImageGate({
      customRefs: [
        { id: "c1", url: "https://cdn.example/c.jpg", role: "character" },
        { id: "s1", url: "https://cdn.example/s.jpg", role: "scene" },
      ],
    });
    expect(gate.viaCustomUpload).toBe(true);
    expect(gate.ready).toBe(true);
    expect(
      planManhuaAssetImageSpawns({
        customRefs: [
          { id: "c1", url: "https://cdn.example/c.jpg", role: "character" },
          { id: "s1", url: "https://cdn.example/s.jpg", role: "scene" },
        ],
      }),
    ).toEqual([]);
  });

  it("collects identity urls from custom cast + charsheets", () => {
    const urls = collectManhuaIdentityImageUrls({
      characterIds: ["char_f_07"],
      customRefs: [{ id: "c1", url: "https://cdn.example/c.jpg", role: "character" }],
      assetBlocks: [{ id: "charsheet-char_f_07", outputUrl: "https://cdn.example/sheet.jpg" }],
    });
    expect(urls).toContain("https://cdn.example/c.jpg");
    expect(urls).toContain("https://cdn.example/sheet.jpg");
  });
});
