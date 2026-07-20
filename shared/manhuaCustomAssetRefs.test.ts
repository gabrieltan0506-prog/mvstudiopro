import { describe, expect, it } from "vitest";
import {
  buildManhuaCustomAssetGenFromLibraryPrompt,
  hasCustomCastAndScene,
  normalizeManhuaCustomAssetRefs,
  taggedManhuaCustomAssetRefs,
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

  it("builds gen-from-library prompt without forcing clone", () => {
    const p = buildManhuaCustomAssetGenFromLibraryPrompt({
      role: "character",
      seedLabelZh: "唐若曦",
      seedPromptZh: "利落短发",
      topic: "都市对峙",
    });
    expect(p).toContain("新人物参考图");
    expect(p).toContain("仅作气质/环境/材质参考");
    expect(p).toContain("唐若曦");
  });
});
