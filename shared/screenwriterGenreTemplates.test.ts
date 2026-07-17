import { describe, expect, it } from "vitest";
import {
  buildManhuaStagePromptWithGenre,
  composeGenreTemplatePromptBlock,
  getScreenwriterGenreTemplate,
  inferManhuaGenreFromTopic,
  listScreenwriterGenres,
  recommendManhuaSceneIdFromTopic,
  resolveManhuaGenreId,
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
    // ⑤D：题材「秘境」优先于剧种默认宗门
    expect(story).toContain("秘境洞府");
    expect(story).toContain("外门弟子闯秘境");

    const key = buildManhuaStagePromptWithGenre("key_art", {
      genreId: "campus",
      sceneId: "scene_14",
    });
    expect(key).toContain("校园教室");
    expect(key).toContain("本集主场景优先");
  });

  it("recommends scene id from topic keywords not only genre default", () => {
    const rec = recommendManhuaSceneIdFromTopic({ topic: "外门弟子闯秘境" });
    expect(rec.inferredGenre).toBe(true);
    expect(rec.genreId).toBe("xianxia");
    expect(rec.sceneId).toBe("scene_04");
    expect(recommendManhuaSceneIdFromTopic({ genreId: "urban", topic: "办公室谈判" }).sceneId).toBe(
      "scene_12",
    );
  });

  it("infers genre from topic keywords", () => {
    const x = inferManhuaGenreFromTopic("外门弟子雨夜闯秘境修仙");
    expect(x?.genreId).toBe("xianxia");
    expect(x?.matched.length).toBeGreaterThan(0);
    expect(inferManhuaGenreFromTopic("霸总办公室夜景对峙")?.genreId).toBe("urban");
    expect(inferManhuaGenreFromTopic("普通吃饭") ).toBeNull();
    const r = resolveManhuaGenreId({ topic: "校园教室青春告白" });
    expect(r.inferred).toBe(true);
    expect(r.genreId).toBe("campus");
    expect(resolveManhuaGenreId({ genreId: "scifi", topic: "校园" }).inferred).toBe(false);
    expect(resolveManhuaGenreId({ genreId: "scifi", topic: "校园" }).genreId).toBe("scifi");
  });
});
