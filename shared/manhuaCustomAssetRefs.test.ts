import { describe, expect, it } from "vitest";
import {
  buildManhuaCustomAssetGenFromLibraryPrompt,
  hasCustomCastAndScene,
  inferManhuaCustomAssetRole,
  MANHUA_CUSTOM_ASSET_REFS_MAX,
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

  /**
   * 主角拆两张后，两张图共用同一个 seedLibraryId。若只按它去重，后出的
   * 全身照会覆盖大头照，结果一张 identity 都不剩——锁脸没图，绑定句的
   * 「面部特征参考 / 妆造参考」分工也不会出现，整个拆图等于白做。
   */
  it("同一角色的大头照与全身照共存，旧拼版图被同分工的新图顶掉", () => {
    let refs = upsertGeneratedManhuaCustomAssetRef([], {
      url: "https://cdn.example/old-sheet.png",
      role: "character",
      labelZh: "沈沧澜",
      seedLibraryId: "wa_char_shence",
      refDuty: "identity",
    });
    refs = upsertGeneratedManhuaCustomAssetRef(refs, {
      url: "https://cdn.example/face.png",
      role: "character",
      labelZh: "沈沧澜",
      seedLibraryId: "wa_char_shence",
      refDuty: "identity",
    });
    refs = upsertGeneratedManhuaCustomAssetRef(refs, {
      url: "https://cdn.example/body.png",
      role: "character",
      labelZh: "沈沧澜",
      seedLibraryId: "wa_char_shence",
      refDuty: "look",
    });

    expect(refs).toHaveLength(2);
    // 旧拼版图与大头照同为 identity → 被顶掉，不残留在垫图里
    expect(refs.map((r) => r.url)).not.toContain("https://cdn.example/old-sheet.png");
    expect(refs.find((r) => r.refDuty === "identity")?.url).toBe(
      "https://cdn.example/face.png",
    );
    expect(refs.find((r) => r.refDuty === "look")?.url).toBe(
      "https://cdn.example/body.png",
    );
  });

  it("一集全量设定图（8人+6场景+6道具）都装得下，不在第十六张截断", () => {
    let refs: ReturnType<typeof normalizeManhuaCustomAssetRefs> = [];
    // 8 名人物，其中两位主角脸与全身各一张 → 10 条
    const chars = ["沈沧澜", "陆清和", "沈岐山", "苏问蝉", "陆镇渊", "萧承弼", "韩伯", "玄甲卫"];
    chars.forEach((nameZh, i) => {
      refs = upsertGeneratedManhuaCustomAssetRef(refs, {
        url: `https://cdn.example/char-${i}-body.png`,
        role: "character",
        labelZh: nameZh,
        seedLibraryId: `wa_char_${i}`,
        refDuty: i < 2 ? "look" : "identity",
      });
      if (i < 2) {
        refs = upsertGeneratedManhuaCustomAssetRef(refs, {
          url: `https://cdn.example/char-${i}-face.png`,
          role: "character",
          labelZh: nameZh,
          seedLibraryId: `wa_char_${i}`,
          refDuty: "identity",
        });
      }
    });
    for (let i = 0; i < 6; i += 1) {
      refs = upsertGeneratedManhuaCustomAssetRef(refs, {
        url: `https://cdn.example/scene-${i}.png`,
        role: "scene",
        labelZh: `场景${i}`,
        seedLibraryId: `wa_scene_${i}`,
        refDuty: "space",
      });
    }
    for (let i = 0; i < 6; i += 1) {
      refs = upsertGeneratedManhuaCustomAssetRef(refs, {
        url: `https://cdn.example/prop-${i}.png`,
        role: "prop",
        labelZh: `道具${i}`,
        seedLibraryId: `wa_prop_${i}`,
        refDuty: "style",
      });
    }

    expect(refs).toHaveLength(22);
    expect(refs.filter((r) => r.role === "character")).toHaveLength(10);
    expect(refs.filter((r) => r.role === "scene")).toHaveLength(6);
    expect(refs.filter((r) => r.role === "prop")).toHaveLength(6);
    // 最后挂上的道具没有被容量截掉
    expect(refs.map((r) => r.url)).toContain("https://cdn.example/prop-5.png");
  });

  it("第 49 条 normalize 截断，容量恒为 48", () => {
    const roles = ["character", "scene", "prop"] as const;
    const raw = Array.from({ length: 60 }, (_, i) => ({
      id: `id_${i}`,
      url: `https://cdn.example/r-${i}.jpg`,
      role: roles[i % 3]!,
    }));
    const refs = normalizeManhuaCustomAssetRefs(raw);
    expect(MANHUA_CUSTOM_ASSET_REFS_MAX).toBe(48);
    expect(refs).toHaveLength(48);
    expect(refs[0]!.url).toBe("https://cdn.example/r-0.jpg");
    expect(refs.map((r) => r.url)).not.toContain("https://cdn.example/r-59.jpg");
  });
});
