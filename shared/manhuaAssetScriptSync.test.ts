import { describe, expect, it } from "vitest";
import {
  collectStaleAssetSheetBlockIds,
  evaluateManhuaAssetScriptAlignment,
  fingerprintManhuaWriterAssetCanon,
  purgeStaleCustomAssetRefsForCanon,
} from "./manhuaAssetScriptSync";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon";

const canon: ManhuaWriterAssetCanon = {
  characters: [
    {
      id: "wa_c_shen",
      role: "character",
      nameZh: "沈照野",
      lookZh: "青衫长剑",
      promptZh: "沈照野 青衫长剑",
    },
  ],
  props: [],
  locations: [
    {
      id: "wa_l_bridge",
      role: "scene",
      nameZh: "断桥雨夜",
      lookZh: "石桥夜雨",
      promptZh: "断桥雨夜 石桥夜雨",
    },
  ],
  episodeMainSceneId: { 1: "wa_l_bridge" },
};

describe("manhuaAssetScriptSync", () => {
  it("fingerprints cast+locations", () => {
    const a = fingerprintManhuaWriterAssetCanon(canon);
    const b = fingerprintManhuaWriterAssetCanon({
      ...canon,
      characters: [{ ...canon.characters[0]!, nameZh: "别的人" }],
    });
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("flags stale generated refs and sheets from old cast", () => {
    const align = evaluateManhuaAssetScriptAlignment({
      assetCanon: canon,
      customRefs: [
        {
          id: "1",
          url: "https://cdn.example/old.jpg",
          role: "character",
          source: "generated",
          labelZh: "旧皇宫女主",
          seedLibraryId: "wa_c_old",
        },
        {
          id: "2",
          url: "https://cdn.example/ok.jpg",
          role: "character",
          source: "generated",
          labelZh: "沈照野",
          seedLibraryId: "wa_c_shen",
        },
        {
          id: "3",
          url: "https://cdn.example/upload.jpg",
          role: "character",
          source: "upload",
          labelZh: "手传参考",
        },
      ],
      assetBlocks: [
        { id: "charsheet-wa_c_old" },
        { id: "charsheet-wa_c_shen" },
        { id: "sceneplate-wa_l_bridge" },
      ],
    });
    expect(align.aligned).toBe(false);
    expect(align.staleGeneratedRefCount).toBe(1);
    expect(align.staleSheetBlockCount).toBe(1);
    expect(align.hintZh).toMatch(/剧本人物\/场景已变/);
  });

  it("purge removes stale generated; forceAll drops all generated", () => {
    const refs = [
      {
        id: "1",
        url: "https://cdn.example/old.jpg",
        role: "character" as const,
        source: "generated" as const,
        labelZh: "旧人",
        seedLibraryId: "wa_c_old",
      },
      {
        id: "2",
        url: "https://cdn.example/ok.jpg",
        role: "character" as const,
        source: "generated" as const,
        labelZh: "沈照野",
        seedLibraryId: "wa_c_shen",
      },
      {
        id: "3",
        url: "https://cdn.example/u.jpg",
        role: "scene" as const,
        source: "upload" as const,
        labelZh: "手传场景",
      },
    ];
    const soft = purgeStaleCustomAssetRefsForCanon(refs, canon);
    expect(soft.removedCount).toBe(1);
    expect(soft.refs.map((r) => r.id).sort()).toEqual(["2", "3"]);

    const hard = purgeStaleCustomAssetRefsForCanon(refs, canon, {
      forceAllGenerated: true,
    });
    expect(hard.removedCount).toBe(2);
    expect(hard.refs.map((r) => r.id)).toEqual(["3"]);
  });

  it("collectStaleAssetSheetBlockIds forceAllSheets", () => {
    const ids = collectStaleAssetSheetBlockIds(
      [
        { id: "charsheet-wa_c_shen" },
        { id: "sceneplate-wa_l_bridge" },
        { id: "free-node" },
      ],
      canon,
      { forceAllSheets: true },
    );
    expect(ids.sort()).toEqual(["charsheet-wa_c_shen", "sceneplate-wa_l_bridge"]);
  });
});
