import { describe, expect, it } from "vitest";
import {
  collectStaleAssetSheetBlockIds,
  evaluateManhuaAssetScriptAlignment,
  findManhuaAssetCoverageGaps,
  fingerprintManhuaWriterAssetCanon,
  planManhuaSheetAdoptions,
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

  it("扩写新增人物：旧资产没过期，但缺图必须报出来", () => {
    const expanded: ManhuaWriterAssetCanon = {
      ...canon,
      characters: [
        canon.characters[0]!,
        {
          id: "wa_c_pei",
          role: "character",
          nameZh: "裴砚舟",
          lookZh: "玄甲披风",
          promptZh: "裴砚舟 玄甲披风",
        },
      ],
    };
    const res = evaluateManhuaAssetScriptAlignment({
      assetCanon: expanded,
      customRefs: [],
      assetBlocks: [
        { id: "charsheet-wa_c_shen", hasMedia: true },
        { id: "sceneplate-wa_l_bridge", hasMedia: true },
      ],
    });
    expect(res.staleGeneratedRefCount).toBe(0);
    expect(res.staleSheetBlockCount).toBe(0);
    expect(res.aligned).toBe(false);
    expect(res.coverageGaps.map((g) => g.nameZh)).toEqual(["裴砚舟"]);
    expect(res.hintZh).toContain("裴砚舟");
  });

  it("自传参考按名字认领，认不到的人物仍算缺口", () => {
    const expanded: ManhuaWriterAssetCanon = {
      ...canon,
      characters: [
        canon.characters[0]!,
        {
          id: "wa_c_pei",
          role: "character",
          nameZh: "裴砚舟",
          lookZh: "玄甲披风",
          promptZh: "裴砚舟 玄甲披风",
        },
      ],
    };
    const gaps = findManhuaAssetCoverageGaps({
      assetCanon: expanded,
      customRefs: [
        { id: "u1", role: "character", source: "upload", labelZh: "沈照野", url: "u" },
        { id: "u2", role: "scene", source: "upload", labelZh: "断桥雨夜", url: "u" },
      ] as never,
      assetBlocks: [],
    });
    expect(gaps.map((g) => g.nameZh)).toEqual(["裴砚舟"]);
  });

  it("图齐时无缺口", () => {
    const res = evaluateManhuaAssetScriptAlignment({
      assetCanon: canon,
      customRefs: [],
      assetBlocks: [
        { id: "charsheet-wa_c_shen", hasMedia: true },
        { id: "sceneplate-wa_l_bridge", hasMedia: true },
      ],
    });
    expect(res.aligned).toBe(true);
    expect(res.coverageGaps).toEqual([]);
  });

  describe("planManhuaSheetAdoptions", () => {
    it("已出图但没进我的角色/场景/道具的，全部要认领（含道具）", () => {
      const canonWithProp: ManhuaWriterAssetCanon = {
        ...canon,
        props: [
          {
            id: "wa_p_hu",
            role: "prop",
            nameZh: "象牙色朝笏",
            lookZh: "细长微弯",
            promptZh: "象牙色朝笏",
          },
        ],
      };
      const plans = planManhuaSheetAdoptions({
        blocks: [
          { id: "charsheet-wa_c_shen", outputUrl: "https://x/c.png" },
          { id: "sceneplate-wa_l_bridge", outputUrl: "https://x/s.png" },
          { id: "propsheet-wa_p_hu", outputUrl: "https://x/p.png" },
        ],
        customRefs: [],
        assetCanon: canonWithProp,
      });
      expect(plans.map((p) => p.role)).toEqual(["character", "scene", "prop"]);
      expect(plans.map((p) => p.labelZh)).toEqual([
        "沈照野",
        "断桥雨夜",
        "象牙色朝笏",
      ]);
    });

    it("已认领的不重复挂（幂等）", () => {
      const plans = planManhuaSheetAdoptions({
        blocks: [{ id: "charsheet-wa_c_shen", outputUrl: "https://x/c.png" }],
        customRefs: [
          {
            id: "r1",
            role: "character",
            source: "generated",
            seedLibraryId: "wa_c_shen",
            labelZh: "沈照野",
            url: "https://x/c.png",
          },
        ] as never,
        assetCanon: canon,
      });
      expect(plans).toEqual([]);
    });

    it("主角脸特写与全身照各挂一张：face 块不被全身照的 seed 吃掉", () => {
      const plans = planManhuaSheetAdoptions({
        blocks: [
          { id: "charsheet-wa_c_shen", outputUrl: "https://x/body.png" },
          { id: "charsheet-face-wa_c_shen", outputUrl: "https://x/face.png" },
        ],
        customRefs: [
          {
            id: "r1",
            role: "character",
            source: "generated",
            seedLibraryId: "wa_c_shen",
            labelZh: "沈照野",
            url: "https://x/body.png",
          },
        ] as never,
        assetCanon: canon,
      });
      expect(plans.map((p) => p.blockId)).toEqual(["charsheet-face-wa_c_shen"]);
      expect(plans[0]!.seedId).toBe("wa_c_shen");
    });

    it("没出图的空卡不认领", () => {
      const plans = planManhuaSheetAdoptions({
        blocks: [
          { id: "charsheet-wa_c_shen" },
          { id: "sceneplate-wa_l_bridge", outputUrls: [] },
        ],
        customRefs: [],
        assetCanon: canon,
      });
      expect(plans).toEqual([]);
    });

    it("四格拼板标出 grid2x2，认领时才会切图挂主视角", () => {
      const plans = planManhuaSheetAdoptions({
        blocks: [
          {
            id: "sceneplate-wa_l_bridge",
            prompt: "四格 2×2 版式：同一场景四个机位",
            outputUrl: "https://x/s.png",
          },
        ],
        customRefs: [],
        assetCanon: canon,
      });
      expect(plans[0]!.layout).toBe("grid2x2");
    });
  });
});
