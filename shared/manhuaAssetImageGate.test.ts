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
    expect(bothNoSheets.hintZh).toMatch(/资产设定|设定图/);
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

  it("forceEpisodeSheets still plans when custom pad already unlocked gate", () => {
    const plans = planManhuaAssetImageSpawns(
      {
        characterIds: ["char_f_07"],
        sceneId: "scene_04",
        customRefs: [
          { id: "c1", url: "https://cdn.example/c.jpg", role: "character" },
          { id: "s1", url: "https://cdn.example/s.jpg", role: "scene" },
        ],
      },
      { forceEpisodeSheets: true },
    );
    expect(plans.some((p) => p.kind === "charsheet" && p.id.includes("char_f_07"))).toBe(true);
    expect(plans.some((p) => p.kind === "sceneplate" && p.id.includes("scene_04"))).toBe(true);
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

  it("viaWriterCanon: plans charsheet/sceneplate from table anchors", () => {
    const assetCanon = {
      characters: [
        {
          id: "wa_char_shen",
          role: "character" as const,
          nameZh: "沈砚舟",
          lookZh: "玄色鹤氅",
          promptZh: "原创角色设定卡·沈砚舟。外形：玄色鹤氅。",
        },
      ],
      props: [],
      locations: [
        {
          id: "wa_scene_miao",
          role: "scene" as const,
          nameZh: "山神破庙",
          lookZh: "断梁神像",
          motiveZh: "阴冷破败",
          promptZh: "原创场景空镜·山神破庙。氛围：阴冷破败。",
        },
      ],
      episodeMainSceneId: { 1: "wa_scene_miao" },
    };
    const gate = evaluateManhuaAssetImageGate({
      assetCanon,
      episodeIndex: 1,
    });
    expect(gate.viaWriterCanon).toBe(true);
    expect(gate.castLocked).toBe(true);
    expect(gate.sceneLocked).toBe(true);
    expect(gate.ready).toBe(false);

    const plans = planManhuaAssetImageSpawns({ assetCanon, episodeIndex: 1, topic: "鹤归" });
    expect(plans.some((p) => p.id.includes("wa_char_shen"))).toBe(true);
    expect(plans.some((p) => p.id.includes("wa_scene_miao"))).toBe(true);

    const ready = evaluateManhuaAssetImageGate({
      assetCanon,
      episodeIndex: 1,
      assetBlocks: [
        { id: "charsheet-wa_char_shen", outputUrl: "https://cdn.example/c.jpg" },
        { id: "sceneplate-wa_scene_miao", outputUrl: "https://cdn.example/s.jpg" },
      ],
    });
    expect(ready.ready).toBe(true);
    expect(ready.viaWriterCanon).toBe(true);
  });
});
