import { describe, expect, it } from "vitest";
import { buildManhuaAssetRoleGroups } from "./manhuaAssetEntityGroups";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

const anchor = (id: string, nameZh: string, role: "character" | "scene" | "prop") => ({
  id,
  role,
  nameZh,
  lookZh: "",
});

const canon = {
  characters: [anchor("wa_char_aqing", "阿菁", "character"), anchor("wa_char_mo", "墨菁", "character")],
  locations: [anchor("wa_scene_yiguan", "长明医馆", "scene")],
  props: [anchor("wa_prop_zhuo", "银镯", "prop")],
} as never;

const ref = (over: Partial<ManhuaCustomAssetRef> & { id: string }): ManhuaCustomAssetRef =>
  ({
    url: `https://example.test/${over.id}.png`,
    role: "character",
    source: "generated",
    ...over,
  }) as ManhuaCustomAssetRef;

describe("资产页实体分组（版本栈的 UI 投影）", () => {
  it("同名多版本收进一个实体组，组头报当前采用的职责，计数报实体数+张数", () => {
    const refs = [
      ref({ id: "a1", labelZh: "阿菁-候选", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({
        id: "a2",
        labelZh: "阿菁-定妆",
        claimedAnchorIds: ["wa_char_aqing"],
        primaryBindings: [{ anchorId: "wa_char_aqing", duty: "identity" }],
      }),
      ref({ id: "a3", labelZh: "阿菁-编辑", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({
        id: "m1",
        labelZh: "墨菁-定妆",
        claimedAnchorIds: ["wa_char_mo"],
        primaryBindings: [
          { anchorId: "wa_char_mo", duty: "identity" },
          { anchorId: "wa_char_mo", duty: "look" },
        ],
      }),
    ];
    const out = buildManhuaAssetRoleGroups({ refs, assetCanon: canon, role: "character" });
    expect(out.entityCount).toBe(2);
    expect(out.imageCount).toBe(4);
    expect(out.headerCountZh).toBe("2 个人物 · 4 张图");
    const aqing = out.groups.find((g) => g.anchorId === "wa_char_aqing")!;
    expect(aqing.refs.map((r) => r.id)).toEqual(["a2", "a1", "a3"]);
    expect(aqing.currentZh).toBe("当前：锁脸（妆造未定）");
    const mo = out.groups.find((g) => g.anchorId === "wa_char_mo")!;
    expect(mo.currentZh).toBe("当前：锁脸 + 妆造");
    // 反例对照：没有 primaryBindings 的实体不许显示成已定
    const nobind = buildManhuaAssetRoleGroups({
      refs: [ref({ id: "x1", claimedAnchorIds: ["wa_char_aqing"] })],
      assetCanon: canon,
      role: "character",
    });
    expect(nobind.groups[0].hasCurrent).toBe(false);
    expect(nobind.groups[0].currentZh).toBe("未定当前版本");
  });

  it("缺当前版本的实体排在前面，认领不到的图单独一组且明说不参与出片", () => {
    const refs = [
      ref({
        id: "a2",
        claimedAnchorIds: ["wa_char_aqing"],
        primaryBindings: [{ anchorId: "wa_char_aqing", duty: "identity" }],
      }),
      ref({ id: "m1", claimedAnchorIds: ["wa_char_mo"] }),
      ref({ id: "z9", labelZh: "网图-没认领" }),
    ];
    const out = buildManhuaAssetRoleGroups({ refs, assetCanon: canon, role: "character" });
    expect(out.groups.map((g) => g.key)).toEqual(["wa_char_mo", "wa_char_aqing", "__unclaimed"]);
    expect(out.missingCurrentCount).toBe(1);
    const unclaimed = out.groups.at(-1)!;
    expect(unclaimed.kind).toBe("unclaimed");
    expect(unclaimed.titleZh).toBe("未认领到剧本人物");
    expect(unclaimed.currentZh).toContain("不参与出片");
    expect(unclaimed.refs.map((r) => r.id)).toEqual(["z9"]);
    // 反例对照：全部有当前版本时不许凭空多出「未认领」组
    const allBound = buildManhuaAssetRoleGroups({
      refs: [refs[0]!],
      assetCanon: canon,
      role: "character",
    });
    expect(allBound.groups.map((g) => g.kind)).toEqual(["entity"]);
    expect(allBound.missingCurrentCount).toBe(0);
  });

  it("一张图被两个人物认领时只渲染一次，另一组写共用说明（勾选删除不会看到两张同图卡）", () => {
    const refs = [
      ref({ id: "duo", labelZh: "阿菁与墨菁合影", claimedAnchorIds: ["wa_char_aqing", "wa_char_mo"] }),
    ];
    const out = buildManhuaAssetRoleGroups({ refs, assetCanon: canon, role: "character" });
    const rendered = out.groups.flatMap((g) => g.refs.map((r) => r.id));
    expect(rendered).toEqual(["duo"]);
    const owner = out.groups.find((g) => g.refs.length)!;
    expect(owner.alsoInZhByRefId["duo"]).toBe("同时是「墨菁」的参考图");
    const borrower = out.groups.find((g) => g.anchorId && !g.refs.length)!;
    expect(borrower.sharedNoteZh).toContain("共用");
    expect(out.entityCount).toBe(2);
    expect(out.imageCount).toBe(1);
  });

  it("A-pose / 状态图带用途标，不与锁脸图混成一堆", () => {
    const refs = [
      ref({
        id: "a2",
        labelZh: "阿菁-锁脸",
        claimedAnchorIds: ["wa_char_aqing"],
        primaryBindings: [{ anchorId: "wa_char_aqing", duty: "identity" }],
      }),
      ref({
        id: "a3",
        labelZh: "阿菁-妆造",
        refDuty: "look",
        claimedAnchorIds: ["wa_char_aqing"],
      }),
      ref({ id: "a4", labelZh: "阿菁 A-pose 展臂", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({ id: "a5", labelZh: "阿菁-受伤状态", claimedAnchorIds: ["wa_char_aqing"] }),
    ];
    const out = buildManhuaAssetRoleGroups({ refs, assetCanon: canon, role: "character" });
    const aqing = out.groups[0]!;
    // 当前采用版本按它担的职责标；refDuty 填了的按 refDuty 标；剩下的按标签识别，认不出就是「其它版本」
    expect(aqing.useZhByRefId["a2"]).toBe("锁脸");
    expect(aqing.useZhByRefId["a3"]).toBe("妆造");
    expect(aqing.useZhByRefId["a4"]).toBe("A-pose");
    expect(aqing.useZhByRefId["a5"]).toBe("状态");
    expect(aqing.refs).toHaveLength(4);
    // 反例对照：什么线索都没有的图不许被猜成锁脸
    const vague = buildManhuaAssetRoleGroups({
      refs: [ref({ id: "n1", labelZh: "阿菁-新", claimedAnchorIds: ["wa_char_aqing"] })],
      assetCanon: canon,
      role: "character",
    });
    expect(vague.groups[0].useZhByRefId["n1"]).toBe("其它版本");
  });

  it("没有实体维度的栏（服装）退回平铺，不盖「未认领」帽子、不假装分组", () => {
    const refs = [
      ref({ id: "w1", role: "wardrobe", labelZh: "红裙" }),
      ref({ id: "w2", role: "wardrobe", labelZh: "夜行衣" }),
    ];
    const out = buildManhuaAssetRoleGroups({ refs, assetCanon: canon, role: "wardrobe" });
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].kind).toBe("flat");
    expect(out.groups[0].titleZh).toBe("");
    expect(out.groups[0].refs.map((r) => r.id)).toEqual(["w1", "w2"]);
    expect(out.headerCountZh).toBe("2 张图");
    expect(out.entityCount).toBe(0);
  });

  it("场景/道具用自己的量词和口径，人物的「锁脸/妆造」文案不串栏", () => {
    const refs = [
      ref({
        id: "s1",
        role: "scene",
        claimedAnchorIds: ["wa_scene_yiguan"],
        primaryBindings: [{ anchorId: "wa_scene_yiguan", duty: "identity" }],
      }),
      ref({ id: "s2", role: "scene", claimedAnchorIds: ["wa_scene_yiguan"] }),
    ];
    const scenes = buildManhuaAssetRoleGroups({ refs, assetCanon: canon, role: "scene" });
    expect(scenes.headerCountZh).toBe("1 个场景 · 2 张图");
    expect(scenes.groups[0].currentZh).toBe("当前版本已定");
    const props = buildManhuaAssetRoleGroups({
      refs: [ref({ id: "p1", role: "prop", claimedAnchorIds: ["wa_prop_zhuo"] })],
      assetCanon: canon,
      role: "prop",
    });
    expect(props.headerCountZh).toBe("1 件道具 · 1 张图");
    expect(props.groups[0].currentZh).toBe("未定当前版本");
  });

  it("没有剧本资产表时不许把图归到任何实体，也不许报出实体数", () => {
    const refs = [ref({ id: "a1", claimedAnchorIds: ["wa_char_aqing"] })];
    const out = buildManhuaAssetRoleGroups({ refs, assetCanon: null, role: "character" });
    expect(out.entityCount).toBe(0);
    expect(out.groups[0].kind).toBe("flat");
    expect(out.groups[0].refs.map((r) => r.id)).toEqual(["a1"]);
  });
});
