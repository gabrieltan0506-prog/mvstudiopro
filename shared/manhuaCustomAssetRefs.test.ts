import { describe, expect, it } from "vitest";
import {
  buildManhuaCustomAssetGenFromLibraryPrompt,
  hasCustomCastAndScene,
  inferManhuaCustomAssetRole,
  normalizeManhuaCustomAssetRefs,
  taggedManhuaCustomAssetRefs,
  upsertGeneratedManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs";

describe("manhuaCustomAssetRefs", () => {
  it("keeps https only and drops unset from tagged", () => {
    const refs = normalizeManhuaCustomAssetRefs([
      { id: "1", url: "https://cdn.example/a.jpg", role: "character" },
      { id: "2", url: "http://insecure.example/b.jpg", role: "scene" },
      { id: "3", url: "https://cdn.example/c.jpg", role: "unset" },
      { id: "4", url: "https://cdn.example/a.jpg", role: "prop" },
    ]);
    expect(refs).toHaveLength(2);
    expect(taggedManhuaCustomAssetRefs(refs)).toHaveLength(1);
    expect(hasCustomCastAndScene(refs)).toBe(false);
    expect(
      hasCustomCastAndScene([
        ...refs,
        { id: "5", url: "https://cdn.example/s.jpg", role: "scene" },
      ]),
    ).toBe(true);
  });

  it("builds gen-from-library prompt without forcing clone and with hard no-text", () => {
    const p = buildManhuaCustomAssetGenFromLibraryPrompt({
      role: "character",
      seedLabelZh: "唐若曦",
      seedPromptZh: "利落短发",
      topic: "都市对峙",
    });
    expect(p).toContain("新人物参考图");
    expect(p).toContain("仅作气质/环境/材质参考");
    expect(p).toContain("唐若曦");
    expect(p).toContain("禁字硬锁");
    expect(p).toContain("STRICT NO TEXT");
  });

  it("reclassifies palace hall mis-tagged as character into scene", () => {
    expect(
      inferManhuaCustomAssetRole({
        role: "character",
        seedLibraryId: "scene_06",
        labelZh: "皇宫大殿",
      }),
    ).toBe("scene");
    const repaired = normalizeManhuaCustomAssetRefs([
      {
        id: "1",
        url: "https://cdn.example/palace.jpg",
        role: "character",
        labelZh: "皇宫大殿",
        seedLibraryId: "scene_06",
        source: "generated",
      },
    ]);
    expect(repaired[0]?.role).toBe("scene");
  });

  it("rewrites raw arch_ english ids into Chinese library names", () => {
    const refs = normalizeManhuaCustomAssetRefs([
      {
        id: "1",
        url: "https://cdn.example/a.jpg",
        role: "character",
        labelZh: "arch_phoenix_empress",
        seedLibraryId: "arch_phoenix_empress",
        source: "generated",
      },
    ]);
    expect(refs[0]?.labelZh).toBe("凤曌女帝");
    expect(refs[0]?.role).toBe("character");
  });

  it("upserts generated sheets into my library by seed id across roles", () => {
    const first = upsertGeneratedManhuaCustomAssetRef([], {
      url: "https://cdn.example/c1.jpg",
      role: "character",
      labelZh: "乌策",
      seedLibraryId: "wa_char_wu",
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.source).toBe("generated");
    const second = upsertGeneratedManhuaCustomAssetRef(first, {
      url: "https://cdn.example/c1b.jpg",
      role: "character",
      labelZh: "乌策",
      seedLibraryId: "wa_char_wu",
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.url).toBe("https://cdn.example/c1b.jpg");
    const withScene = upsertGeneratedManhuaCustomAssetRef(second, {
      url: "https://cdn.example/s1.jpg",
      role: "scene",
      labelZh: "悬雨桥",
      seedLibraryId: "wa_scene_bridge",
    });
    expect(withScene).toHaveLength(2);
    const fixedPalace = upsertGeneratedManhuaCustomAssetRef([], {
      url: "https://cdn.example/hall.jpg",
      role: "character",
      labelZh: "皇宫大殿",
      seedLibraryId: "scene_06",
    });
    expect(fixedPalace[0]?.role).toBe("scene");
  });
});