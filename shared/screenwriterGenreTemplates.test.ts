import { describe, expect, it } from "vitest";
import {
  SCREENWRITER_GENRE_TEMPLATES,
  buildManhuaStagePromptWithGenre,
  composeGenreTemplatePromptBlock,
  getScreenwriterGenreTemplate,
  listScreenwriterGenres,
} from "./screenwriterGenreTemplates";
import type { ScreenwriterGenreTemplate } from "./screenwriterGenreTemplates";

describe("screenwriterGenreTemplates", () => {
  it("lists placeholder genres as not ready by default", () => {
    const list = listScreenwriterGenres();
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.every((g) => g.ready === false)).toBe(true);
    expect(composeGenreTemplatePromptBlock(list[0]!)).toBe("");
  });

  it("ignores unread genre when building stage prompt", () => {
    const p = buildManhuaStagePromptWithGenre("story_brief", {
      genreId: "campus_angst",
      topic: "雨夜天台",
    });
    expect(p).toContain("雨夜天台");
    expect(p).not.toContain("【编剧剧种模板");
  });

  it("applies ready genre block to story/bible/beats", () => {
    const ready: ScreenwriterGenreTemplate = {
      ...getScreenwriterGenreTemplate("campus_angst")!,
      ready: true,
      pitch: "错过与最后一眼",
      hookPattern: "倒计时对峙",
      characterSlots: "男主/女主",
      beatSkeleton: "1 对视 2 伸手 3 门合",
      dialogueTone: "短句",
      avoid: "说教",
      stageAddons: { story_brief: "钩子必须含倒计时" },
    };
    // 临时注入：测 compose / build 逻辑不改全局表
    const block = composeGenreTemplatePromptBlock(ready);
    expect(block).toContain("校园虐心");
    expect(block).toContain("倒计时对峙");

    const idx = SCREENWRITER_GENRE_TEMPLATES.findIndex((g) => g.id === "campus_angst");
    const prev = SCREENWRITER_GENRE_TEMPLATES[idx]!;
    SCREENWRITER_GENRE_TEMPLATES[idx] = ready;
    try {
      const story = buildManhuaStagePromptWithGenre("story_brief", {
        genreId: "campus_angst",
        topic: "车站离别",
      });
      expect(story).toContain("【编剧剧种模板");
      expect(story).toContain("钩子必须含倒计时");
      expect(story).toContain("车站离别");
      const reverse = buildManhuaStagePromptWithGenre("video_reverse", {
        genreId: "campus_angst",
      });
      expect(reverse).not.toContain("【编剧剧种模板");
    } finally {
      SCREENWRITER_GENRE_TEMPLATES[idx] = prev;
    }
  });
});
