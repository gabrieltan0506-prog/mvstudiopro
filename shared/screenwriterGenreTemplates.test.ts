import { describe, expect, it } from "vitest";
import {
  buildManhuaStagePromptWithGenre,
  composeGenreTemplatePromptBlock,
  getScreenwriterGenreTemplate,
  listScreenwriterGenres,
} from "./screenwriterGenreTemplates";

describe("screenwriterGenreTemplates + scene library", () => {
  it("lists seven ready genre packs tied to scene assets", () => {
    const list = listScreenwriterGenres({ onlyReady: true });
    expect(list).toHaveLength(7);
    expect(list.map((g) => g.id)).toEqual([
      "xianxia",
      "ancient",
      "urban",
      "campus",
      "apocalypse",
      "scifi",
      "suspense",
    ]);
  });

  it("injects scene catalog into story / beats / key art", () => {
    const genre = getScreenwriterGenreTemplate("xianxia");
    expect(composeGenreTemplatePromptBlock(genre)).toContain("仙侠");
    const story = buildManhuaStagePromptWithGenre("story_brief", {
      genreId: "xianxia",
      topic: "外门弟子闯秘境",
    });
    expect(story).toContain("【编剧剧种模板");
    expect(story).toContain("仙侠宗门");
    expect(story).toContain("外门弟子闯秘境");

    const key = buildManhuaStagePromptWithGenre("key_art", {
      genreId: "campus",
      sceneId: "scene_14",
    });
    expect(key).toContain("校园教室");
    expect(key).toContain("本集主场景优先");
  });
});
