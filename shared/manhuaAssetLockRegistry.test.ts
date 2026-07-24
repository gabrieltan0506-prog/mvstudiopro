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
    expect(plan.imageUrls[0]).toBe("https://cdn.example/tail.jpg");
    expect(plan.entries.some((e) => e.kind === "asset" && e.roleTag === "@角色1")).toBe(
      true,
    );
    expect(plan.bindLineZh).toMatch(/@角色1=@Image\d+/);
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
