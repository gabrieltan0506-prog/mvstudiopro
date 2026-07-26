import { describe, expect, it } from "vitest";
import {
  areManhuaKeyartsPixelLocked,
  assignManhuaCanvasAssetAtTags,
  buildManhuaAssetLockRegistry,
  buildManhuaAssetPathById,
  buildManhuaMentionCandidates,
  findManhuaSegmentAssetBindGap,
  formatManhuaAssetImageBindBlock,
  hasManhuaSegmentAssetBindGap,
  isManhuaKeyartPixelLocked,
  parseManhuaAssetImageBindBlock,
  parseManhuaCanvasAssetAtTag,
  planManhuaClipSeedanceImageBind,
  resolveManhuaAssetImageBindRows,
  resolveManhuaSegmentClipAllowedAssets,
  sanitizeManhuaClipPromptForUi,
  splitManhuaCastZhNames,
  stripManhuaAssetUrlsFromPrompt,
  upsertManhuaPromptAssetBindRow,
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

  /**
   * 官方规范：「图片N」指 content 数组里第 N 个 image_url。图号一旦和实际发图
   * 错位，模型就会把 A 角色的脸贴到 B 身上——比不绑还糟。
   */
  it("图号严格对应实际发图顺序，且不留英文 Image", () => {
    const plan = planManhuaClipSeedanceImageBind({
      assetRows: [
        { tag: "@角色1", id: "a", labelZh: "沈沧澜", path: "https://cdn.example/a.jpg" },
        { tag: "@角色2", id: "b", labelZh: "苏照雪", path: "https://cdn.example/b.jpg" },
        { tag: "@场景1", id: "s", labelZh: "断月桥", path: "https://cdn.example/s.jpg" },
      ],
      stillUrls: ["https://cdn.example/still.jpg"],
      tailUrls: ["https://cdn.example/tail.jpg"],
      maxImages: 9,
    });

    for (const e of plan.entries) {
      expect(plan.imageUrls[e.imageIndex - 1]).toBe(e.url);
    }
    expect(plan.bindLineZh).not.toMatch(/@Image/i);
    expect(plan.bindLineZh).toContain("沈沧澜@图片1");
    expect(plan.bindLineZh).toContain("苏照雪@图片2");
    expect(plan.bindLineZh).toContain("断月桥@图片3");
    // 末帧垫底：优先级最低的素材不该占前排权重位
    expect(plan.entries[plan.entries.length - 1]?.kind).toBe("tail");
  });

  /**
   * 官方把「人脸与全身/服装拼在一张」列为 ID 漂移头号根因，主角因此拆两张。
   * 分工措辞只在真的有两张时写：配角单张肖像同时锁脸与服化，写成
   * 「面部特征参考」会暗示另有一张妆造图。
   */
  it("一人两张才写面部/妆造分工，单张肖像不写", () => {
    const twoShot = planManhuaClipSeedanceImageBind({
      assetRows: [
        {
          tag: "@角色1",
          id: "f",
          labelZh: "沈沧澜",
          path: "https://cdn.example/face.jpg",
          duty: "identity",
        },
        {
          tag: "@角色2",
          id: "b",
          labelZh: "沈沧澜",
          path: "https://cdn.example/body.jpg",
          duty: "look",
        },
      ],
      stillUrls: ["https://cdn.example/still.jpg"],
      maxImages: 9,
    });
    // 大头照在前：锁脸最吃紧
    expect(twoShot.imageUrls[0]).toBe("https://cdn.example/face.jpg");
    expect(twoShot.bindLineZh).toContain("沈沧澜的面部特征参考@图片1");
    expect(twoShot.bindLineZh).toContain("沈沧澜的妆造参考@图片2");

    const oneShot = planManhuaClipSeedanceImageBind({
      assetRows: [
        {
          tag: "@角色1",
          id: "s",
          labelZh: "马县丞",
          path: "https://cdn.example/solo.jpg",
          duty: "identity",
        },
      ],
      stillUrls: ["https://cdn.example/still.jpg"],
      maxImages: 9,
    });
    expect(oneShot.bindLineZh).toContain("马县丞@图片1");
    expect(oneShot.bindLineZh).not.toContain("面部特征参考");
  });

  it("duty 经【资产·Image对照】往返不丢", () => {
    const block = [
      "【资产·Image对照】",
      "@角色1|id=f|label=沈沧澜|kind=角色|duty=identity",
      "@角色2|id=b|label=沈沧澜|kind=角色|duty=look",
      "@场景1|id=s1|label=断月桥|kind=场景",
    ].join("\n");
    const rows = parseManhuaAssetImageBindBlock(block);
    expect(rows.map((r) => r.duty)).toEqual(["identity", "look", null]);
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
    expect(findManhuaSegmentAssetBindGap(reg, allowed).sceneFallbackToZh).toBe("雪关粮仓");
  });

  it("names the matched characters that still have no usable image", () => {
    // 直接搭 registry：logical:// 的参考过不了 normalizeManhuaCustomAssetRefs 的
    // isHttpsUrl，走 builder 造不出「有槽但没图」的角色。这里验的是函数契约本身
    const slots = [
      {
        tag: "@角色1",
        role: "character" as const,
        index: 1,
        id: "c_shen",
        labelZh: "沈沧澜",
        path: "logical://sheet/c_shen",
      },
      {
        tag: "@场景1",
        role: "scene" as const,
        index: 1,
        id: "s_bridge",
        labelZh: "断月桥",
        path: "https://cdn.example/bridge.jpg",
      },
    ];
    const reg = {
      slots,
      byRole: {
        character: slots.filter((s) => s.role === "character"),
        scene: slots.filter((s) => s.role === "scene"),
        prop: [],
        wardrobe: [],
      },
      promptBlockZh: "",
      sheetPropSlots: [],
      wardrobeSlots: [],
    };
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack: "【第1段·15s】断月桥\n0–5s：沈沧澜绷紧侧脸。",
      castZh: "沈沧澜",
      registry: reg,
      castCount: 1,
    });
    // 名字对上了 id，所以既有的 mismatch 红条不会亮、出片门禁照样放行
    expect(allowed.mode).toBe("matched");
    // 可对照表里一个角色都没有——这一段出片其实没锁脸
    expect(
      formatManhuaAssetImageBindBlock(reg, 8, { allowedIds: allowed.allowedIds }),
    ).not.toContain("沈沧澜");

    const gap = findManhuaSegmentAssetBindGap(reg, allowed);
    expect(gap.characterNamesZh).toEqual(["沈沧澜"]);
    expect(gap.sceneNamesZh).toEqual([]);
    expect(hasManhuaSegmentAssetBindGap(gap)).toBe(true);
  });

  it("reports no gap once every matched asset has a real image", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c_shen",
          url: "https://cdn.example/shen.jpg",
          role: "character",
          source: "generated",
          labelZh: "沈沧澜",
        },
        {
          id: "s_bridge",
          url: "https://cdn.example/bridge.jpg",
          role: "scene",
          source: "upload",
          labelZh: "断月桥",
        },
      ],
    });
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack: "【第1段·15s】断月桥\n0–5s：沈沧澜绷紧侧脸。",
      castZh: "沈沧澜",
      registry: reg,
      castCount: 1,
    });
    const gap = findManhuaSegmentAssetBindGap(reg, allowed);
    expect(hasManhuaSegmentAssetBindGap(gap)).toBe(false);
    expect(gap.sceneFallbackToZh).toBeNull();
  });

  it("stays quiet on empty segments that legitimately have nobody", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "s_bridge",
          url: "https://cdn.example/bridge.jpg",
          role: "scene",
          source: "upload",
          labelZh: "断月桥",
        },
      ],
    });
    // 空镜段：可拍表没点名，本来就不该报缺脸
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      haystack: "【第2段·15s】断月桥\n0–5s：雨点砸在空桥板上。",
      registry: reg,
    });
    expect(allowed.mode).toBe("empty");
    expect(hasManhuaSegmentAssetBindGap(findManhuaSegmentAssetBindGap(reg, allowed))).toBe(
      false,
    );
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

describe("分镜静帧按秒段锁定", () => {
  it("每张静帧绑到自己那几秒，且不吃掉末帧席位", () => {
    const plan = planManhuaClipSeedanceImageBind({
      assetRows: [
        { tag: "@角色1", id: "c1", path: "https://x/a.jpg", labelZh: "沈照野" },
      ],
      stillUrls: ["https://x/s1.jpg", "https://x/s2.jpg", "https://x/s3.jpg"],
      stillSlotsZh: ["0–5s", "5–10s", "10–15s"],
      tailUrls: ["https://x/tail.jpg"],
      maxImages: 6,
    });
    expect(plan.bindLineZh).toContain("锁定0–5s的画面构图、机位与光色");
    expect(plan.bindLineZh).toContain("锁定5–10s");
    expect(plan.bindLineZh).toContain("锁定10–15s");
    expect(plan.entries.some((e) => e.kind === "tail")).toBe(true);
  });

  it("没有秒段信息时退回旧写法", () => {
    const plan = planManhuaClipSeedanceImageBind({
      assetRows: [],
      stillUrls: ["https://x/s1.jpg"],
    });
    expect(plan.bindLineZh).toContain("为本段构图与光色基准");
  });
});

describe("@ 唤起：候选来自资产库，不是提示词自己", () => {
  const reg = buildManhuaAssetLockRegistry({
    customRefs: [
      {
        id: "c_shen",
        url: "https://cdn.example/shen.jpg",
        role: "character",
        source: "generated",
        labelZh: "沈沧澜",
      },
      {
        id: "s_bridge",
        url: "https://cdn.example/bridge.jpg",
        role: "scene",
        source: "upload",
        labelZh: "断月桥",
      },
    ],
  });
  const anchor = (id: string, role: "character" | "scene", nameZh: string) => ({
    id,
    role,
    nameZh,
    lookZh: "",
    promptZh: "",
  });
  // 方昭妃只在剧本里，定妆图还没出：registry 不会有她的槽
  const canon = {
    characters: [anchor("wa_char_shen", "character", "沈沧澜"), anchor("wa_char_fang", "character", "方昭妃")],
    props: [],
    locations: [anchor("wa_scene_bridge", "scene", "断月桥")],
    episodeMainSceneId: {},
  };

  it("提示词一张图都没绑时照样列得出候选", () => {
    // 老实现从提示词自带对照表取候选，这里必然为空、面板永不弹——
    // 偏偏这正是最需要挑图的时刻
    const list = buildManhuaMentionCandidates({
      registry: reg,
      prompt: "【第1段·15s】断月桥\n0–5s：雨夜，有人立在桥头。",
    });
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((c) => c.labelZh)).toContain("沈沧澜");
    expect(list.every((c) => c.bound === false)).toBe(true);
  });

  it("剧本刚写出、还没出图的角色也列，标成待出图", () => {
    const list = buildManhuaMentionCandidates({ registry: reg, prompt: "", assetCanon: canon });
    const fang = list.find((c) => c.labelZh === "方昭妃");
    expect(fang).toBeTruthy();
    expect(fang?.ready).toBe(false);
    expect(fang?.pending).toBe(true);
    // 没有槽就没有编号，只能点去补图，不能插进正文
    expect(fang?.tag).toBe("");
  });

  it("同名的不因设定表再占一格", () => {
    const list = buildManhuaMentionCandidates({ registry: reg, prompt: "", assetCanon: canon });
    expect(list.filter((c) => c.labelZh === "沈沧澜")).toHaveLength(1);
    expect(list.find((c) => c.labelZh === "沈沧澜")?.ready).toBe(true);
  });

  it("角色排在场景前，待出图的沉到同类末尾", () => {
    const list = buildManhuaMentionCandidates({ registry: reg, prompt: "", assetCanon: canon });
    const kinds = list.map((c) => c.kind);
    expect(kinds.indexOf("角色")).toBeLessThan(kinds.indexOf("场景"));
    const chars = list.filter((c) => c.kind === "角色");
    expect(chars[0]?.ready).toBe(true);
    expect(chars[chars.length - 1]?.pending).toBe(true);
  });

  it("已在对照表里的标出 bound，避免重复插一遍", () => {
    const prompt = ["【资产·Image对照】", "@角色1|id=c_shen|label=沈沧澜|kind=角色"].join(
      "\n",
    );
    const list = buildManhuaMentionCandidates({ registry: reg, prompt });
    expect(list.find((c) => c.assetId === "c_shen")?.bound).toBe(true);
    expect(list.find((c) => c.assetId === "s_bridge")?.bound).toBe(false);
  });
});

describe("挑完资产要落进对照表", () => {
  const row = {
    tag: "@角色1",
    assetId: "c_shen",
    labelZh: "沈沧澜",
    kind: "角色",
    duty: "identity" as const,
  };

  it("表还不存在时新建，且解析得回来", () => {
    const next = upsertManhuaPromptAssetBindRow("【第1段·15s】断月桥\n0–5s：拔刀。", row);
    const parsed = parseManhuaAssetImageBindBlock(next);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ tag: "@角色1", id: "c_shen", duty: "identity" });
    // 正文一个字不能丢
    expect(next).toContain("0–5s：拔刀。");
  });

  it("已有表时追加，不冲掉旧行", () => {
    const base = ["【资产·Image对照】", "@场景1|id=s_bridge|label=断月桥|kind=场景"].join(
      "\n",
    );
    const parsed = parseManhuaAssetImageBindBlock(upsertManhuaPromptAssetBindRow(base, row));
    expect(parsed.map((r) => r.id).sort()).toEqual(["c_shen", "s_bridge"]);
  });

  it("同一个 tag 改写而不是插两行", () => {
    const once = upsertManhuaPromptAssetBindRow("", row);
    const twice = upsertManhuaPromptAssetBindRow(once, { ...row, labelZh: "沈沧澜·改" });
    const parsed = parseManhuaAssetImageBindBlock(twice);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.labelZh).toBe("沈沧澜·改");
  });

  it("不吃掉对照表后面的段落", () => {
    const base = [
      "【资产·Image对照】",
      "@场景1|id=s_bridge|label=断月桥|kind=场景",
      "【出片Image硬绑】",
      "沈沧澜@图片1。",
    ].join("\n");
    const next = upsertManhuaPromptAssetBindRow(base, row);
    expect(next).toContain("【出片Image硬绑】");
    expect(next).toContain("沈沧澜@图片1。");
    expect(parseManhuaAssetImageBindBlock(next)).toHaveLength(2);
  });
})

/**
 * 道具有了自己的单件图之后，特写格草稿得让位。
 *
 * 草稿按 canon 的 wa_prop_* 编号，真图那行的槽 id 却是 cust_*：只比 id 会漏，
 * 于是同一件道具出两行——一行是自己的单件图，一行是那张角色定妆卡的 URL。
 * 模型两张都当参考，等于把锁脸的权重摊给了道具。
 */
describe("道具单件图 vs 定妆特写格草稿", () => {
  const canon = {
    characters: [
      {
        id: "wa_char_shen",
        role: "character" as const,
        nameZh: "沈砚舟",
        lookZh: "玄色鹤氅，腰悬双鱼玉佩",
        promptZh: "沈砚舟",
      },
    ],
    props: [
      {
        id: "wa_prop_yupei",
        role: "prop" as const,
        nameZh: "双鱼玉佩",
        lookZh: "半佩温玉",
        promptZh: "玉佩",
      },
    ],
    locations: [],
    episodeMainSceneId: {},
  } as unknown as ManhuaWriterAssetCanon;

  const sheetUrlByCharacterId = { wa_char_shen: "https://cdn.example/shen-sheet.jpg" };

  it("没有单件图时仍走特写格：拿到的是那张定妆卡，锁不住道具本体", () => {
    const reg = buildManhuaAssetLockRegistry({
      assetCanon: canon,
      characterSheetUrlById: sheetUrlByCharacterId,
    });
    const props = reg.slots.filter((s) => s.role === "prop");
    expect(props).toHaveLength(1);
    expect(props[0]?.path).toBe(sheetUrlByCharacterId.wa_char_shen);
  });

  it("有了单件图就只留一行，且指向道具自己的图", () => {
    const reg = buildManhuaAssetLockRegistry({
      assetCanon: canon,
      characterSheetUrlById: sheetUrlByCharacterId,
      customRefs: [
        {
          id: "cust_jade",
          url: "https://cdn.example/jade.jpg",
          role: "prop",
          source: "generated",
          labelZh: "双鱼玉佩",
          seedLibraryId: "wa_prop_yupei",
        },
      ],
    });
    const props = reg.slots.filter((s) => s.role === "prop");
    expect(props).toHaveLength(1);
    expect(props[0]?.path).toBe("https://cdn.example/jade.jpg");
    // 单件图进得了后台 path 表，才是真锁；从前的 logical:// 占位会被直接过滤掉
    expect(buildManhuaAssetPathById(reg)[props[0]!.id]).toBe("https://cdn.example/jade.jpg");
  });

  it("只对得上名字（seedLibraryId 缺）也算同一件，不重复占号", () => {
    const reg = buildManhuaAssetLockRegistry({
      assetCanon: canon,
      characterSheetUrlById: sheetUrlByCharacterId,
      customRefs: [
        {
          id: "cust_jade",
          url: "https://cdn.example/jade.jpg",
          role: "prop",
          source: "upload",
          labelZh: "双鱼玉佩",
        },
      ],
    });
    expect(reg.slots.filter((s) => s.role === "prop")).toHaveLength(1);
  });

  it("段内点名道具时，绑的是道具单件图而不是那张角色定妆卡", () => {
    const reg = buildManhuaAssetLockRegistry({
      assetCanon: canon,
      characterSheetUrlById: sheetUrlByCharacterId,
      customRefs: [
        {
          id: "cust_shen",
          url: "https://cdn.example/shen-face.jpg",
          role: "character",
          source: "generated",
          labelZh: "沈砚舟",
          seedLibraryId: "wa_char_shen",
        },
        {
          id: "cust_jade",
          url: "https://cdn.example/jade.jpg",
          role: "prop",
          source: "generated",
          labelZh: "双鱼玉佩",
          seedLibraryId: "wa_prop_yupei",
        },
      ],
    });
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      registry: reg,
      assetCanon: canon,
      castZh: "沈砚舟",
      haystack: "沈砚舟摩过腰间双鱼玉佩，指节收紧。",
    });
    expect(allowed.propIds).toHaveLength(1);
    const bind = formatManhuaAssetImageBindBlock(reg, 12, { allowedIds: allowed.allowedIds });
    const rows = resolveManhuaAssetImageBindRows(
      parseManhuaAssetImageBindBlock(bind),
      buildManhuaAssetPathById(reg),
    );
    const jade = rows.find((r) => r.tag.startsWith("@道具"));
    expect(jade?.path).toBe("https://cdn.example/jade.jpg");
    const plan = planManhuaClipSeedanceImageBind({
      assetRows: rows,
      stillUrls: ["https://cdn.example/still1.jpg"],
      mentionedTags: [jade!.tag],
    });
    expect(plan.entries.some((e) => e.url === "https://cdn.example/jade.jpg")).toBe(true);
  });
});
