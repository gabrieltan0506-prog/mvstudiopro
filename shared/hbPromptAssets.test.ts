import { describe, expect, it } from "vitest";
import {
  INFOGRAPHIC_NOTE_TEMPLATES,
  composeInfographicScriptContext,
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
  it("infographic templates are layout-only and bind user copy", () => {
    expect(INFOGRAPHIC_NOTE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const joined = INFOGRAPHIC_NOTE_TEMPLATES.map((t) => t.layoutPromptEn).join("\n");
    expect(joined).not.toMatch(/阿里巴巴|Alibaba|Hermès|Tesla|Leica|青铜器/i);
    const userCopy =
      "# 小红书全链路引流与获客\n\n公域曝光到成交复购的完整闭环。";
    const ctx = composeInfographicScriptContext({
      templateId: "infographic_business_ecosystem",
      userCopy,
    });
    expect(ctx).toContain("小红书全链路引流与获客");
    expect(ctx).toContain("用户正文·唯一内容来源");
    expect(ctx).not.toMatch(/阿里巴巴|Alibaba/i);
    expect(fillInfographicTemplatePrompt("infographic_material_lab", "用户主题")).toContain(
      "encyclopedic",
    );
  });

  it("image2 templates expose 10 prompts", () => {
    expect(IMAGE2_PROMPT_TEMPLATES).toHaveLength(10);
    expect(buildImage2TemplatePrompt("i2_upscale_clarity")).toContain("4K");
  });

  it("html ppt builds horizontal deck from confirmed outline", () => {
    expect(Object.keys(HTML_PPT_STYLES).length).toBeGreaterThanOrEqual(9);
    expect(recommendHtmlPptStyle("创业路演")).toBe("pitch_orange");
    expect(recommendHtmlPptStyle("季度复盘")).toBe("figma_timeline");
    expect(recommendHtmlPptStyle("周报简报")).toBe("ocean_brief");
    const pitchPages = buildDefaultHtmlPptPages("融资路演", 7, "创业路演", "pitch_orange");
    expect(pitchPages.some((p) => /解决方案|商业模式/.test(p.title))).toBe(true);
    const pages = buildDefaultHtmlPptPages("AI 趋势", 6, "数据洞察", "dark_research");
    const html = buildHtmlPptDocument({
      title: "AI 趋势",
      styleId: "dark_research",
      pages,
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toContain(HTML_PPT_STYLES.dark_research.labelZh);
    expect(html).toContain("controls{position:fixed;top:12px;right:12px");
    expect(html).toContain("竖屏阅读模式");
    expect(html).toContain("translateX");
    expect(html).toContain("下一步动效");
    expect(html).toContain("is-active");
    expect(html).toContain("playEnter");
    expect(html).toContain("nextBuild");
    expect(html).toContain("data-build");
    expect(html).toContain("fx-show");
    expect(html).toContain("btnNextBuild");
    expect(html).toContain("/html-ppt-templates/dark_research/bg.png");
    expect(html).toContain("@keyframes rise");
    expect(html).toMatch(/viz-(ring|bars|columns|steps|cards|cover|compare)/);
    expect(html).toContain("ring-svg");
    expect(html).toContain("hbar-fill");
    expect(html).toContain("#22d3ee");
    expect(html).toContain("#a78bfa");
    expect(html).toContain("#a3e635");
    expect(html).toContain("#fb923c");
    expect(html).toContain("class=\"rank\"");
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
    expect(resolvePlatformSkillCategory({ id: "website-html-ppt" })).toBe("deck");
    expect(resolvePlatformSkillCategory({ id: "graphic-note-rhythm" })).toBe("graphic");
    expect(resolvePlatformSkillCategory({ id: "ai-feed-ad" })).toBe("video");
    const groups = groupPlatformSkillsByCategory([
      { id: "ai-feed-ad", source: "builtin" },
      { id: "encyclopedic-infographic", source: "builtin" },
      { id: "website-html-ppt", source: "builtin" },
      { id: "graphic-note-rhythm", source: "builtin" },
    ]);
    expect(groups.map((g) => g.category.id)).toEqual(["graphic", "templates", "deck", "video"]);
    expect(listImage2TemplatesByGroup().map((g) => g.group.id)).toEqual([
      "portrait",
      "lifestyle",
      "scene",
      "stylize",
    ]);
    expect(listInfographicTemplatesByMode().length).toBeGreaterThanOrEqual(3);
  });
});
