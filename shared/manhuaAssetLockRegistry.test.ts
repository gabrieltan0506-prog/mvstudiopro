import { describe, expect, it } from "vitest";
import {
  areManhuaKeyartsPixelLocked,
  assignManhuaCanvasAssetAtTags,
  buildManhuaAssetLockRegistry,
  buildManhuaAssetPathById,
  formatManhuaAssetImageBindBlock,
  isManhuaKeyartPixelLocked,
  parseManhuaAssetImageBindBlock,
  parseManhuaCanvasAssetAtTag,
  planManhuaClipSeedanceImageBind,
  resolveManhuaAssetImageBindRows,
  resolveManhuaSegmentClipAllowedAssets,
  sanitizeManhuaClipPromptForUi,
  splitManhuaCastZhNames,
  stripManhuaAssetUrlsFromPrompt,
} from "./manhuaAssetLockRegistry";
import { parseManhuaSheetPropSubTagsFromPrompt } from "./manhuaSheetPropSubTags";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon";

describe("manhuaAssetLockRegistry", () => {
  it("numbers upload character/scene/prop as @角色/@场景/@道具", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c1",
          url: "https://cdn.example/char.jpg",
          role: "character",
          source: "upload",
          labelZh: "女主",
        },
        {
          id: "s1",
          url: "https://cdn.example/scene.jpg",
          role: "scene",
          source: "upload",
          labelZh: "大殿",
        },
        {
          id: "p1",
          url: "https://cdn.example/prop.jpg",
          role: "prop",
          source: "upload",
          labelZh: "玉佩",
        },
      ],
    });
    expect(reg.byRole.character[0]?.tag).toBe("@角色1");
    expect(reg.byRole.scene[0]?.tag).toBe("@场景1");
    expect(reg.byRole.prop[0]?.tag).toBe("@道具1");
    expect(reg.promptBlockZh).toContain("【资产锁·编号对照·必守】");
    expect(reg.promptBlockZh).toContain("@角色1=女主");
  });

  it("includes generated character refs in lock table (本集定妆也进@)", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "g1",
          url: "https://cdn.example/gen.jpg",
          role: "character",
          source: "generated",
          labelZh: "生成脸",
        },
      ],
    });
    expect(reg.byRole.character).toHaveLength(1);
    expect(reg.byRole.character[0]?.tag).toBe("@角色1");
  });

  it("stamps @ tags onto canvas asset sheet prompts", () => {
    const stamped = assignManhuaCanvasAssetAtTags([
      { id: "charsheet-hero", prompt: "女主定妆" },
      { id: "sceneplate-inn", prompt: "客栈" },
      { id: "propplate-jade", prompt: "玉佩" },
      { id: "keyart-e01-s01", prompt: "静帧" },
    ]);
    expect(parseManhuaCanvasAssetAtTag(stamped[0]!.prompt)).toBe("@角色1");
    expect(parseManhuaCanvasAssetAtTag(stamped[1]!.prompt)).toBe("@场景1");
    expect(parseManhuaCanvasAssetAtTag(stamped[2]!.prompt)).toBe("@道具1");
    expect(parseManhuaCanvasAssetAtTag(stamped[3]!.prompt)).toBeNull();
    expect(stamped[0]!.prompt).toContain("女主定妆");
  });

  it("auto-numbers sheet inset props as @道具N with sub tags", () => {
    const canon: ManhuaWriterAssetCanon = {
      characters: [
        {
          id: "wa_char_hero",
          role: "character",
          nameZh: "沈少主",
          lookZh: "腰佩玉佩",
          promptZh: "沈少主",
        },
      ],
      props: [
        {
          id: "wa_prop_jade",
          role: "prop",
          nameZh: "玉佩",
          lookZh: "白玉",
          noteZh: "沈少主",
          promptZh: "玉佩",
        },
      ],
      locations: [],
      episodeMainSceneId: {},
    };
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "wa_char_hero",
          url: "https://cdn.example/hero.jpg",
          role: "character",
          source: "generated",
          labelZh: "沈少主",
        },
      ],
      assetCanon: canon,
      characterSheetUrlById: {
        wa_char_hero: "https://cdn.example/hero-sheet.jpg",
      },
    });
    expect(reg.sheetPropSlots.length).toBeGreaterThanOrEqual(1);
    expect(reg.byRole.prop.some((p) => p.id === "wa_prop_jade" && p.fromSheetInset)).toBe(
      true,
    );
    expect(reg.promptBlockZh).toContain("定妆特写");
    expect(reg.sheetPropSlots[0]?.subTag).toMatch(/@角色\d+·道具\d+/);

    const stamped = assignManhuaCanvasAssetAtTags(
      [{ id: "charsheet-wa_char_hero", prompt: "定妆卡" }],
      { registry: reg, assetCanon: canon },
    );
    const subs = parseManhuaSheetPropSubTagsFromPrompt(stamped[0]!.prompt);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]?.propTag).toMatch(/^@道具\d+$/);
  });

  it("prompt bind table has id only (no URL); path resolves offline for @角色=@Image", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c1",
          url: "https://cdn.example/char.jpg",
          role: "character",
          source: "upload",
          labelZh: "女主",
        },
        {
          id: "s1",
          url: "https://cdn.example/scene.jpg",
          role: "scene",
          source: "upload",
          labelZh: "大殿",
        },
      ],
    });
    const block = formatManhuaAssetImageBindBlock(reg);
    expect(block).toContain("【资产·Image对照】");
    expect(block).toContain("@角色1|id=c1|label=女主");
    expect(block).not.toMatch(/https?:\/\//);
    expect(block).not.toContain("cdn.example");
    const pathById = buildManhuaAssetPathById(reg);
    expect(pathById.c1).toBe("https://cdn.example/char.jpg");
    const rows = resolveManhuaAssetImageBindRows(
      parseManhuaAssetImageBindBlock(block),
      pathById,
    );
    expect(rows).toHaveLength(2);
    const plan = planManhuaClipSeedanceImageBind({
      assetRows: rows,
      stillUrls: ["https://cdn.example/still.jpg"],
      tailUrls: ["https://cdn.example/tail.jpg"],
      mentionedTags: ["@角色1"],
      maxImages: 6,
    });
    // 重要素材前置：被点名的角色资产占首位，上段末帧只管承接起幅、垫底
    expect(plan.imageUrls[0]).toBe("https://cdn.example/char.jpg");
    expect(plan.imageUrls[plan.imageUrls.length - 1]).toBe("https://cdn.example/tail.jpg");
    expect(plan.entries.some((e) => e.kind === "asset" && e.roleTag === "@角色1")).toBe(
      true,
    );
    // 官方指代式：主体名直接贴中文图号，不用 @角色N= 中转、不写英文 Image
    expect(plan.bindLineZh).toMatch(/女主@图片\d+/);
    expect(plan.bindLineZh).not.toMatch(/@Image/);
    expect(plan.bindLineZh).toContain("id=c1");
    expect(plan.bindLineZh).not.toMatch(/https?:\/\//);
    expect(stripManhuaAssetUrlsFromPrompt(`${block}\nhttps://leak.example/x.jpg`)).not.toMatch(
      /https?:\/\//,
    );
    expect(
      stripManhuaAssetUrlsFromPrompt(
        "@角色1|id=c1|label=女主|https://cdn.example/a.jpg\n预览图：/manhua-characters/x.jpg",
      ),
    ).not.toMatch(/https?:\/\/|\/manhua-|预览图：/);
  });

  it("keeps the segment still and spends the rest on assets, not on a 2nd tail", () => {
    const assetRows = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i + 1}`,
      tag: i < 4 ? `@角色${i + 1}` : i < 6 ? `@场景${i - 3}` : `@道具${i - 5}`,
      labelZh: `资产${i + 1}`,
      path: `https://cdn.example/asset${i + 1}.jpg`,
    }));
    const plan = planManhuaClipSeedanceImageBind({
      assetRows,
      stillUrls: ["https://cdn.example/still.jpg"],
      tailUrls: ["https://cdn.example/tail1.jpg", "https://cdn.example/tail2.jpg"],
      maxImages: 9,
    });
    expect(plan.imageUrls).toHaveLength(9);
    // 末帧只留 1 席：第二张几乎只重复起幅信息，却要挤掉一个角色/场景/道具
    expect(plan.entries.filter((e) => e.kind === "tail")).toHaveLength(1);
    // 本段静帧是「这一段长什么样」的唯一依据，绝不能被挤掉
    expect(plan.entries.filter((e) => e.kind === "still")).toHaveLength(1);
    expect(plan.entries.filter((e) => e.kind === "asset")).toHaveLength(7);
    // @ImageN 必须与实际发出的数组同序，否则模型拿到断裂的映射
    expect(plan.entries.map((e) => e.imageIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("never soft-locks library order when cast names miss (no 马县丞 fake)", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "cust_ma",
          url: "https://cdn.example/ma.jpg",
          role: "character",
          source: "upload",
          labelZh: "马县丞",
        },
        {
          id: "cust_su",
          url: "https://cdn.example/su.jpg",
          role: "character",
          source: "upload",
          labelZh: "苏文谦",
        },
        {
          id: "cust_xue",
          url: "https://cdn.example/xue.jpg",
          role: "character",
          source: "upload",
          labelZh: "苏照雪",
        },
        {
          id: "cust_zhao",
          url: "https://cdn.example/zhao.jpg",
          role: "character",
          source: "upload",
          labelZh: "赵十三",
        },
      ],
    });
    // 秒轴只有描述词、可拍表点名苏文谦/苏照雪 → 必须锁真名，禁止库序前两人
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack:
        "【第1段·15s】断月桥\n黑衣剑客踩灭箭火，白衣女子取账。说「你取账，我断绳」。",
      castZh: "苏文谦断绳；苏照雪取账",
      registry: reg,
      castCount: 2,
    });
    expect(splitManhuaCastZhNames("苏文谦断绳；苏照雪取账")).toEqual(
      expect.arrayContaining(["苏文谦", "苏照雪"]),
    );
    expect(allowed.characterIds).toEqual(
      expect.arrayContaining(["cust_su", "cust_xue"]),
    );
    expect(allowed.characterIds).not.toContain("cust_ma");
    expect(allowed.mode).toBe("matched");
    const empty = resolveManhuaSegmentClipAllowedAssets({
      haystack: "夜雨桥板，火箭钉入。",
      castZh: "",
      registry: reg,
      castCount: 2,
    });
    expect(empty.characterIds).toEqual([]);
    expect(empty.mode).toBe("empty");
  });

  it("segment clip allowed assets: name-hit chars + one scene; no full cast/props dump", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c_jian",
          url: "https://cdn.example/jian.jpg",
          role: "character",
          source: "upload",
          labelZh: "黑衣剑客",
        },
        {
          id: "c_bai",
          url: "https://cdn.example/bai.jpg",
          role: "character",
          source: "upload",
          labelZh: "白衣女子",
        },
        {
          id: "c_xian",
          url: "https://cdn.example/xian.jpg",
          role: "character",
          source: "upload",
          labelZh: "马县丞",
        },
        {
          id: "c4",
          url: "https://cdn.example/c4.jpg",
          role: "character",
          source: "upload",
          labelZh: "赵十三",
        },
        {
          id: "c5",
          url: "https://cdn.example/c5.jpg",
          role: "character",
          source: "upload",
          labelZh: "韩廷玉",
        },
        {
          id: "s_bridge",
          url: "https://cdn.example/bridge.jpg",
          role: "scene",
          source: "upload",
          labelZh: "断月桥",
        },
        {
          id: "s_cang",
          url: "https://cdn.example/cang.jpg",
          role: "scene",
          source: "upload",
          labelZh: "雪关粮仓",
        },
        {
          id: "p_knife",
          url: "https://cdn.example/knife.jpg",
          role: "prop",
          source: "upload",
          labelZh: "玄铁缺口刀",
        },
        {
          id: "p_yu",
          url: "https://cdn.example/yu.jpg",
          role: "prop",
          source: "upload",
          labelZh: "半枚双鱼玉佩",
        },
      ],
    });
    const hay =
      "【第1段·15s】断月桥\n0–5s：黑衣剑客踩灭箭火，白衣女子取账册。";
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack: hay,
      registry: reg,
      mainSceneId: "s_cang",
      castCount: 2,
    });
    expect(allowed.characterIds).toEqual(
      expect.arrayContaining(["c_jian", "c_bai"]),
    );
    expect(allowed.characterIds).not.toContain("c_xian");
    expect(allowed.characterIds.length).toBeLessThanOrEqual(2);
    expect(allowed.sceneIds).toEqual(["s_bridge"]);
    expect(allowed.propIds).toEqual([]);
    const block = formatManhuaAssetImageBindBlock(reg, 12, {
      allowedIds: allowed.allowedIds,
    });
    expect(block).toContain("黑衣剑客");
    expect(block).toContain("断月桥");
    expect(block).not.toContain("马县丞");
    expect(block).not.toContain("雪关粮仓");
    expect(block).not.toContain("玄铁缺口刀");
  });

  it("flags mismatch instead of dumping an unrelated cast when nothing matches", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c_xian",
          url: "https://cdn.example/xian.jpg",
          role: "character",
          source: "upload",
          labelZh: "马县丞",
        },
        {
          id: "c_su",
          url: "https://cdn.example/su.jpg",
          role: "character",
          source: "upload",
          labelZh: "苏文谦",
        },
        {
          id: "s_cang",
          url: "https://cdn.example/cang.jpg",
          role: "scene",
          source: "upload",
          labelZh: "雪关粮仓",
        },
      ],
    });
    // 剧本换成另一部戏、资产没跟着重出：可拍表点了名，库里一个都对不上
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack: "【第1段·15s】断月桥\n0–5s：燃烧的火箭钉入湿滑桥板，沈沧澜绷紧侧脸。",
      castZh: "沈沧澜、黑衣剑客",
      registry: reg,
      castCount: 2,
    });
    expect(allowed.mode).toBe("mismatch");
    expect(allowed.characterIds).toEqual([]);
    expect(allowed.unmatchedCastNames).toEqual(["沈沧澜", "黑衣剑客"]);
    // 空匹配曾被下游当成「不限制」，于是把全集资产整套喂进成片
    const block = formatManhuaAssetImageBindBlock(reg, 8, {
      allowedIds: allowed.allowedIds,
    });
    expect(block).not.toContain("马县丞");
    expect(block).not.toContain("苏文谦");
  });

  it("keeps listing everything when the caller passes no allow filter", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c_xian",
          url: "https://cdn.example/xian.jpg",
          role: "character",
          source: "upload",
          labelZh: "马县丞",
        },
      ],
    });
    expect(formatManhuaAssetImageBindBlock(reg, 8)).toContain("马县丞");
  });

  it("marks scene as fallback when the script names a place with no asset", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c_jian",
          url: "https://cdn.example/jian.jpg",
          role: "character",
          source: "upload",
          labelZh: "黑衣剑客",
        },
        {
          id: "s_cang",
          url: "https://cdn.example/cang.jpg",
          role: "scene",
          source: "upload",
          labelZh: "雪关粮仓",
        },
      ],
    });
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack: "【第1段·15s】断月桥\n0–5s：黑衣剑客踩灭箭火。",
      registry: reg,
      mainSceneId: "s_cang",
    });
    // 场景可共用，不硬拦；但要让左栏能提示「断月桥没有对应图，用的是雪关粮仓」
    expect(allowed.sceneIds).toEqual(["s_cang"]);
    expect(allowed.sceneFallback).toBe(true);
  });

  it("sanitizeManhuaClipPromptForUi strips 画风 lines", () => {
    const raw = [
      "【第1段·15s】断月桥",
      "0–15s：@角色1，拔刀。近景。",
      "画风：CG 漫剧",
    ].join("\n");
    const out = sanitizeManhuaClipPromptForUi(raw);
    expect(out).toContain("【第1段·15s】");
    expect(out).not.toMatch(/画风：/);
  });

  it("requires edit+ref for pixel lock", () => {
    expect(
      isManhuaKeyartPixelLocked({
        id: "keyart-1",
        imageMode: "generate",
        outputUrl: "https://cdn.example/out.png",
      }),
    ).toBe(false);
    expect(
      isManhuaKeyartPixelLocked({
        id: "keyart-1",
        imageMode: "edit",
        refImageUrl: "https://cdn.example/pad.png",
        outputUrl: "https://cdn.example/out.png",
      }),
    ).toBe(true);
    expect(
      areManhuaKeyartsPixelLocked(
        [
          {
            id: "keyart-a",
            imageMode: "edit",
            refImageUrl: "https://cdn.example/pad.png",
            outputUrl: "https://cdn.example/a.png",
          },
        ],
        { minCount: 1 },
      ),
    ).toBe(true);
  });
});
