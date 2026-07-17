import { describe, expect, it } from "vitest";
import {
  INFOGRAPHIC_NOTE_TEMPLATES,
  fillInfographicTemplatePrompt,
} from "./infographicNoteTemplates";
import { IMAGE2_PROMPT_TEMPLATES, buildImage2TemplatePrompt } from "./image2PromptTemplates";
import {
  HTML_PPT_STYLES,
  buildDefaultHtmlPptPages,
  buildHtmlPptDocument,
  recommendHtmlPptStyle,
} from "./htmlPptMaker";
import { SCENE_STEAL_PROMPT_BANK, buildSceneStealInjectBlock } from "./sceneStealPromptBank";
import { getMotionPromptById } from "./motionPromptBank";
import { PHOTOREAL_ANTI_AI_LOCK_ZH } from "./photorealCharacterPrompt";
import { getManhuaArtStylePreset } from "./manhuaCharacterAssetLibrary";
import {
  groupPlatformSkillsByCategory,
  resolvePlatformSkillCategory,
} from "./platformSkillCategories";
import { listImage2TemplatesByGroup } from "./image2PromptTemplates";
import { listInfographicTemplatesByMode } from "./infographicNoteTemplates";

describe("HB prompt assets", () => {
  it("infographic templates fill subject", () => {
    expect(INFOGRAPHIC_NOTE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const p = fillInfographicTemplatePrompt("infographic_material_lab", "LEICA M11");
    expect(p).toContain("LEICA M11");
    expect(p).toContain("encyclopedic");
  });

  it("image2 templates expose 10 prompts", () => {
    expect(IMAGE2_PROMPT_TEMPLATES).toHaveLength(10);
    expect(buildImage2TemplatePrompt("i2_upscale_clarity")).toContain("4K");
  });

  it("html ppt builds horizontal deck", () => {
    expect(recommendHtmlPptStyle("创业路演")).toBe("pitch_orange");
    expect(recommendHtmlPptStyle("季度复盘")).toBe("figma_timeline");
    const pages = buildDefaultHtmlPptPages("AI 趋势", 6, "数据洞察");
    const html = buildHtmlPptDocument({
      title: "AI 趋势",
      styleId: "dark_research",
      pages,
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(HTML_PPT_STYLES.dark_research.labelZh);
    expect(html).toContain("translateX");
  });

  it("scene steal bank + motion ids align", () => {
    expect(SCENE_STEAL_PROMPT_BANK.length).toBe(3);
    expect(buildSceneStealInjectBlock(["steal_01_titanic_bow"])).toContain("泰坦尼克");
    expect(getMotionPromptById("steal_03_portal_cross")?.category).toBe("scene_steal");
  });

  it("photoreal style embeds anti-AI lock", () => {
    const style = getManhuaArtStylePreset("photoreal");
    expect(style.promptZh).toContain("去 AI 味");
    expect(PHOTOREAL_ANTI_AI_LOCK_ZH).toContain("毛孔");
  });

  it("skills and templates stay categorized", () => {
    expect(resolvePlatformSkillCategory({ id: "encyclopedic-infographic" })).toBe("templates");
    expect(resolvePlatformSkillCategory({ id: "graphic-note-rhythm" })).toBe("graphic");
    expect(resolvePlatformSkillCategory({ id: "ai-feed-ad" })).toBe("video");
    const groups = groupPlatformSkillsByCategory([
      { id: "ai-feed-ad", source: "builtin" },
      { id: "encyclopedic-infographic", source: "builtin" },
      { id: "graphic-note-rhythm", source: "builtin" },
    ]);
    expect(groups.map((g) => g.category.id)).toEqual(["graphic", "templates", "video"]);
    expect(listImage2TemplatesByGroup().map((g) => g.group.id)).toEqual([
      "portrait",
      "lifestyle",
      "scene",
      "stylize",
    ]);
    expect(listInfographicTemplatesByMode().length).toBeGreaterThanOrEqual(3);
  });
});
