import { describe, expect, it } from "vitest";
import {
  classifyManhuaScriptImportTransition,
  collectStaleAssetSheetBlockIds,
  consumableManhuaCustomAssetRefsForCanon,
  evaluateManhuaAssetScriptAlignment,
  findManhuaAssetCoverageGaps,
  customAssetRefClaimsAnchor,
  fingerprintManhuaWriterAssetCanon,
  markManhuaCustomAssetRefsForCanonChanges,
  planManhuaSheetAdoptions,
  purgeStaleCustomAssetRefsForCanon,
  resolveManhuaAssetClaimEntry,
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
  it("只有标题可确认相同才按同剧导入；缺标题的旧专案继续走换剧保护", () => {
    expect(
      classifyManhuaScriptImportTransition({
        currentSeriesTitle: "《墨菁传》",
        incomingSeriesTitle: "墨 菁 传",
        hasExistingProject: true,
      }),
    ).toBe("same_series");
    expect(
      classifyManhuaScriptImportTransition({
        currentSeriesTitle: "墨菁传",
        incomingSeriesTitle: "另一部剧",
        hasExistingProject: true,
      }),
    ).toBe("new_series");
    expect(
      classifyManhuaScriptImportTransition({
        currentSeriesTitle: "",
        incomingSeriesTitle: "墨菁传",
        hasExistingProject: true,
      }),
    ).toBe("new_series");
    expect(
      classifyManhuaScriptImportTransition({
        incomingSeriesTitle: "墨菁传",
        hasExistingProject: false,
      }),
    ).toBe("initial");
  });

  it("显式多认领优先，隔离图不参与门禁", () => {
    const scene = canon.locations[0]!;
    expect(
      customAssetRefClaimsAnchor(
        {
          id: "r1",
          role: "scene",
          url: "https://cdn.example.com/scene.png",
          claimedAnchorIds: [scene.id],
          reviewStatus: "accepted",
        },
        scene,
      ),
    ).toBe(true);
    expect(
      customAssetRefClaimsAnchor(
        {
          id: "r2",
          role: "scene",
          url: "https://cdn.example.com/bad.png",
          claimedAnchorIds: [scene.id],
          reviewStatus: "needs_review",
        },
        scene,
      ),
    ).toBe(false);
  });

  it("fingerprints cast+locations", () => {
    const a = fingerprintManhuaWriterAssetCanon(canon);
    const b = fingerprintManhuaWriterAssetCanon({
      ...canon,
      characters: [{ ...canon.characters[0]!, nameZh: "别的人" }],
    });
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("旧角色图保留为候选不阻断；当前角色缺图仍按 coverage 阻断", () => {
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
    expect(align.aligned).toBe(true);
    expect(align.staleGeneratedRefCount).toBe(1);
    expect(align.staleSheetBlockCount).toBe(1);
    expect(align.hintZh).toBeNull();
  });

  it("同剧重确认保留全部候选与主图元数据，但旧 canon 绑定不进入生成消费者", () => {
    const refs = [
      {
        id: "current-edit",
        role: "character" as const,
        source: "generated" as const,
        url: "https://cdn.example/current-edit.png",
        labelZh: "沈照野·编辑",
        refDuty: "identity" as const,
        claimedAnchorIds: ["wa_c_shen"],
        claimSource: "manual" as const,
        primaryBindings: [{ anchorId: "wa_c_shen", duty: "identity" as const }],
        primarySelectionScopes: [
          { anchorId: "wa_c_shen", duty: "identity" as const },
        ],
      },
      {
        id: "old-primary",
        role: "character" as const,
        source: "generated" as const,
        url: "https://cdn.example/old.png",
        labelZh: "旧人·编辑",
        refDuty: "identity" as const,
        claimedAnchorIds: ["wa_c_old"],
        claimSource: "manual" as const,
        primaryBindings: [{ anchorId: "wa_c_old", duty: "identity" as const }],
        primarySelectionScopes: [{ anchorId: "wa_c_old", duty: "identity" as const }],
      },
      {
        id: "unclaimed-upload",
        role: "character" as const,
        source: "upload" as const,
        url: "https://cdn.example/unclaimed.png",
        labelZh: "无法识别",
        refDuty: "identity" as const,
      },
    ];
    const before = JSON.stringify(refs);
    const active = consumableManhuaCustomAssetRefsForCanon(refs, canon);
    expect(active.map((ref) => ref.id)).toEqual(["current-edit"]);
    expect(JSON.stringify(refs)).toBe(before);
    expect(refs).toHaveLength(3);
    expect(refs[1]?.primaryBindings).toEqual([
      { anchorId: "wa_c_old", duty: "identity" },
    ]);
  });

  it("缺人物表时给确认剧本入口；有表但未认领才提示认领", () => {
    expect(
      resolveManhuaAssetClaimEntry({
        role: "character",
        primaryDuty: "identity",
        canonCharacterCount: 0,
        claimedCharacterCount: 0,
      }),
    ).toBe("confirm_script");
    expect(
      resolveManhuaAssetClaimEntry({
        role: "character",
        primaryDuty: "identity",
        canonCharacterCount: 2,
        claimedCharacterCount: 0,
      }),
    ).toBe("claim_character");
    expect(
      resolveManhuaAssetClaimEntry({
        role: "scene",
        primaryDuty: null,
        canonCharacterCount: 0,
        claimedCharacterCount: 0,
      }),
    ).toBe("none");
  });

  it("同 anchor 改外形时保留候选与主图元数据，但先隔离旧造型", () => {
    const refs = [
      {
        id: "hero-edit",
        role: "character" as const,
        source: "generated" as const,
        url: "https://cdn.example/hero-edit.png",
        claimedAnchorIds: ["wa_c_shen"],
        claimSource: "manual" as const,
        refDuty: "look" as const,
        primaryBindings: [{ anchorId: "wa_c_shen", duty: "look" as const }],
        primarySelectionScopes: [{ anchorId: "wa_c_shen", duty: "look" as const }],
      },
    ];
    const nextCanon: ManhuaWriterAssetCanon = {
      ...canon,
      characters: [
        {
          ...canon.characters[0]!,
          lookZh: "黑衣蒙眼、前腿微跛",
          promptZh: "沈照野 黑衣蒙眼 前腿微跛",
        },
      ],
    };
    const changed = markManhuaCustomAssetRefsForCanonChanges({
      refs,
      previousCanon: canon,
      nextCanon,
    });

    expect(changed.changedAnchorIds).toEqual(["wa_c_shen"]);
    expect(changed.markedRefCount).toBe(1);
    expect(changed.refs[0]).toMatchObject({
      id: "hero-edit",
      url: refs[0]!.url,
      reviewStatus: "needs_review",
      primaryBindings: refs[0]!.primaryBindings,
      primarySelectionScopes: refs[0]!.primarySelectionScopes,
    });
    expect(consumableManhuaCustomAssetRefsForCanon(changed.refs, nextCanon)).toEqual([]);
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

  it("manifest 中文名可让一张拼板认领多个锚点；手动清除后不再回退猜名", () => {
    const expanded: ManhuaWriterAssetCanon = {
      ...canon,
      characters: [
        canon.characters[0]!,
        { id: "wa_c_pei", role: "character", nameZh: "裴砚舟", lookZh: "玄甲", promptZh: "裴砚舟" },
      ],
    };
    const base = {
      id: "sheet",
      role: "character" as const,
      source: "upload" as const,
      labelZh: "人物设定拼板",
      url: "https://cdn.example/sheet.jpg",
      claimedAnchorNamesZh: ["沈照野", "裴砚舟"],
      claimSource: "manifest" as const,
    };
    expect(
      findManhuaAssetCoverageGaps({
        assetCanon: expanded,
        customRefs: [base],
        assetBlocks: [{ id: "sceneplate-wa_l_bridge", hasMedia: true }],
      }),
    ).toEqual([]);
    expect(
      findManhuaAssetCoverageGaps({
        assetCanon: expanded,
        customRefs: [{ ...base, claimSource: "manual", claimedAnchorIds: [] }],
        assetBlocks: [{ id: "sceneplate-wa_l_bridge", hasMedia: true }],
      }).map((gap) => gap.nameZh),
    ).toEqual(["沈照野", "裴砚舟"]);
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
