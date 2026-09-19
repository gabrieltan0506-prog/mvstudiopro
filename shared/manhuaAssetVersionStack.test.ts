import { describe, expect, it } from "vitest";
import {
  buildManhuaAssetVersionStack,
  countManhuaAssetEntities,
  manhuaAssetVersionUse,
} from "./manhuaAssetVersionStack";
import type { ManhuaCustomAssetRef } from "./manhuaCustomAssetRefs";

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

describe("资产实体版本栈（对现有 refs 的纯函数派生）", () => {
  it("同一人物的多张图聚成一个实体，当前采用版本排在最前", () => {
    const refs = [
      ref({ id: "a1", labelZh: "阿菁-候选", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({
        id: "a2",
        labelZh: "阿菁-定妆",
        claimedAnchorIds: ["wa_char_aqing"],
        primaryBindings: [{ anchorId: "wa_char_aqing", duty: "identity" }],
      }),
      ref({ id: "a3", labelZh: "阿菁-改稿", claimedAnchorIds: ["wa_char_aqing"] }),
    ];
    const stack = buildManhuaAssetVersionStack({ refs, assetCanon: canon });
    const aqing = stack.entities.find((e) => e.anchorId === "wa_char_aqing")!;
    expect(aqing.nameZh).toBe("阿菁");
    expect(aqing.versions).toHaveLength(3);
    expect(aqing.versions[0].ref.id).toBe("a2");
    expect(aqing.versions[0].currentDuties).toEqual(["identity"]);
    expect(aqing.hasCurrent).toBe(true);
    // 反例对照：没有 primaryBindings 就没有当前版本，不许按顺序或时间猜一个
    const noCurrent = buildManhuaAssetVersionStack({
      refs: [ref({ id: "b1", labelZh: "阿菁-候选", claimedAnchorIds: ["wa_char_aqing"] })],
      assetCanon: canon,
    });
    expect(noCurrent.entities[0].hasCurrent).toBe(false);
    expect(noCurrent.entities[0].versions[0].currentDuties).toEqual([]);
  });

  it("A-pose、锁脸、状态图并存：用途分开标注，一张都不合并、不丢", () => {
    const refs = [
      ref({
        id: "lock",
        labelZh: "阿菁-锁脸",
        claimedAnchorIds: ["wa_char_aqing"],
        refDuty: "identity",
      }),
      ref({ id: "apose", labelZh: "阿菁-A-pose", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({ id: "hurt", labelZh: "阿菁-受伤状态", claimedAnchorIds: ["wa_char_aqing"] }),
    ];
    const aqing = buildManhuaAssetVersionStack({ refs, assetCanon: canon }).entities[0];
    expect(aqing.versions).toHaveLength(3);
    expect(aqing.versions.map((v) => v.use).sort()).toEqual(["apose", "identity", "state"]);
  });

  it("认领不到实体的图单独列出，不塞进某个实体充数", () => {
    const refs = [
      ref({ id: "a1", labelZh: "阿菁", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({ id: "x1", labelZh: "路人甲", claimSource: "manual" }),
      ref({ id: "x2", labelZh: "没人认领的图", claimSource: "manual" }),
    ];
    const stack = buildManhuaAssetVersionStack({ refs, assetCanon: canon });
    expect(stack.entities.flatMap((e) => e.versions.map((v) => v.ref.id))).toEqual(["a1"]);
    expect(stack.unclaimed.map((r) => r.id)).toEqual(["x1", "x2"]);
  });

  it("一张图认领多个实体时，每个实体各出现一次——真实情况不是重复", () => {
    const refs = [
      ref({ id: "duo", labelZh: "阿菁与墨菁合影", claimedAnchorIds: ["wa_char_aqing", "wa_char_mo"] }),
    ];
    const stack = buildManhuaAssetVersionStack({ refs, assetCanon: canon });
    expect(stack.entities).toHaveLength(2);
    expect(stack.entities.every((e) => e.versions[0].ref.id === "duo")).toBe(true);
    expect(stack.unclaimed).toEqual([]);
  });

  it("待人工确认的图标出来：不参与出片，但仍留在版本栈里可见", () => {
    const refs = [
      ref({
        id: "r1",
        labelZh: "阿菁-待审",
        claimedAnchorIds: ["wa_char_aqing"],
        reviewStatus: "needs_review",
      }),
    ];
    const stack = buildManhuaAssetVersionStack({ refs, assetCanon: canon });
    // needs_review 的图认领判据里会被挡掉 → 归入 unclaimed，且不会冒充某实体的当前版本
    expect(stack.entities).toHaveLength(0);
    expect(stack.unclaimed.map((r) => r.id)).toEqual(["r1"]);
  });

  it("计数是实体数不是图片数（改版图「人物(18)」那种）", () => {
    const refs = [
      ref({ id: "a1", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({ id: "a2", claimedAnchorIds: ["wa_char_aqing"] }),
      ref({ id: "m1", claimedAnchorIds: ["wa_char_mo"] }),
      ref({ id: "s1", role: "scene", claimedAnchorIds: ["wa_scene_yiguan"] }),
    ];
    const stack = buildManhuaAssetVersionStack({ refs, assetCanon: canon });
    expect(countManhuaAssetEntities(stack, "character")).toBe(2);
    expect(countManhuaAssetEntities(stack, "scene")).toBe(1);
    expect(countManhuaAssetEntities(stack, "prop")).toBe(0);
  });

  it("没有剧本资产表时不瞎归类：全部进 unclaimed", () => {
    const refs = [ref({ id: "a1", labelZh: "阿菁" })];
    const stack = buildManhuaAssetVersionStack({ refs, assetCanon: null });
    expect(stack.entities).toEqual([]);
    expect(stack.unclaimed.map((r) => r.id)).toEqual(["a1"]);
  });

  it("用途识别：识别不出就是 other，不乱归类", () => {
    expect(manhuaAssetVersionUse(ref({ id: "1", refDuty: "identity" }))).toBe("identity");
    expect(manhuaAssetVersionUse(ref({ id: "2", refDuty: "look" }))).toBe("look");
    expect(manhuaAssetVersionUse(ref({ id: "3", labelZh: "阿菁 A-pose" }))).toBe("apose");
    expect(manhuaAssetVersionUse(ref({ id: "4", labelZh: "阿菁-破损状态" }))).toBe("state");
    expect(manhuaAssetVersionUse(ref({ id: "5", labelZh: "阿菁-第三版" }))).toBe("other");
  });
});
