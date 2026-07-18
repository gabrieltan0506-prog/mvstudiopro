/**
 * 动效 PPT 单页插图：百科级信息可视化版式（shared/infographicNoteTemplates）
 * 只锁 layoutPromptEn + 用户页内容；禁止样例品牌/短 bare text。
 */

import {
  HTML_PPT_STYLES,
  type HtmlPptPage,
  type HtmlPptStyleId,
} from "./htmlPptMaker";
import {
  INFOGRAPHIC_LAYOUT_META_ZH,
  INFOGRAPHIC_NOTE_TEMPLATES,
  getInfographicNoteTemplate,
} from "./infographicNoteTemplates";

const CONTENT_LOCK_ZH = `【内容锁定·强制】
1. 只可视化本页 title / bullets / kpi / series 里的主题与结论；禁止换成其他公司/品牌/文物/历史案例。
2. 海报主标题优先取页 title 或 themeTitle；图中文字概括页内要点，不得编造无关实体名。
3. 模板只提供构图与信息密度风格，不提供题材。`;

const PPT_ASPECT_NOTE = `【画幅】横向 16:9 幻灯片插图（presentation slide hero panel），非 3:4 竖版笔记。`;

const SIMPLE_HERO_ZH = `【插图简洁·强制】
1. 做「一眼能懂」的大图示意，不要密密麻麻仪表盘/多图表墙；图中中文 ≤6 个短词/数字，字号够大可读。
2. 主体占画面 60%+；留白干净；用形状/图标/一条主对比代替文字说明书。
3. 若无法做成清晰大图，宁可用单一隐喻插画，也不要塞满标注。`;

export type HtmlPptSlideImagePromptInput = {
  templateId?: string | null;
  page: HtmlPptPage;
  deckTitle?: string;
  /** 演示风格 id：插图配色/气质对齐所选 PPT 模板 */
  styleId?: HtmlPptStyleId | string | null;
};

function pageContextText(page: HtmlPptPage, deckTitle?: string): string {
  const lines: string[] = [];
  const deck = String(deckTitle || "").trim();
  if (deck) lines.push(`演示主题：${deck}`);
  lines.push(`页标题：${String(page.title || "").trim()}`);
  if (page.themeTitle) lines.push(`挂靠主题：${page.themeTitle}`);
  if (page.subtitle) lines.push(`副标题：${page.subtitle}`);
  if (page.kpi) lines.push(`KPI：${page.kpi}`);
  if (page.bullets?.length) {
    lines.push("要点：");
    page.bullets.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
  }
  if (page.series?.length) {
    lines.push("数据 series：");
    page.series.forEach((s) => lines.push(`- ${s.label}: ${s.value}`));
  }
  if (page.highlight?.length) lines.push(`高亮短语：${page.highlight.join(" · ")}`);
  if (page.note) lines.push(`备注：${page.note}`);
  return lines.join("\n").trim();
}

function styleGuideZh(styleId?: string | null): string {
  const id = String(styleId || "").trim() as HtmlPptStyleId;
  const meta = id && id in HTML_PPT_STYLES ? HTML_PPT_STYLES[id] : null;
  if (!meta) {
    return "【演示气质】与路演投屏一致：干净、高对比、少装饰。";
  }
  const p = meta.palette;
  return [
    `【演示气质·对齐所选风格】${meta.labelZh}（${meta.blurbZh}）`,
    `配色倾向：背景 ${p.bg} / 文字 ${p.text} / 强调 ${p.accent} / 卡片 ${p.card}；插图整体色调与材质感须贴合，勿另起一套炫彩仪表盘风。`,
  ].join("\n");
}

/** 从页标题 / theme / viz 语境推荐百科信息图模板 id；auto/空则走启发式 */
export function recommendHtmlPptImageTemplateId(page: HtmlPptPage): string {
  const text = [
    page.title,
    page.themeTitle,
    page.subtitle,
    page.kpi,
    ...(page.bullets || []),
    ...(page.highlight || []),
  ]
    .filter(Boolean)
    .join(" ");

  if (/生态|枢纽|板块|模块|体系|平台|闭环|链路/.test(text)) return "infographic_business_ecosystem";
  if (/预测|未来|时间|路线|阶段|里程碑|规划|202\d|季度|年度/.test(text)) return "infographic_evolution_timeline";
  if (/对比|对照|VS|vs|竞争|前后|国内外|付费.*免费|rival/.test(text)) return "infographic_rival_showdown";
  if (/结构|拆解|层|架构|组成|模块分析|deconstruct/.test(text)) return "infographic_structure_deconstruct";
  if (/工艺|细节|材料|微观|放大镜|craft|模块标注/.test(text)) return "infographic_material_lab";
  if (/传承|工艺质感|heritage|工具链/.test(text)) return "infographic_heritage_craft";

  if (page.viz === "hub") return "infographic_business_ecosystem";
  if (page.viz === "line" || page.viz === "steps") return "infographic_evolution_timeline";
  if (page.viz === "compare") return "infographic_rival_showdown";
  if (page.viz === "columns" || page.viz === "bars") return "infographic_structure_deconstruct";

  return INFOGRAPHIC_NOTE_TEMPLATES[0]?.id || "infographic_material_lab";
}

export function resolveHtmlPptImageTemplateId(
  templateId: string | null | undefined,
  page: HtmlPptPage,
): string {
  const raw = String(templateId || "").trim();
  if (!raw || raw === "auto") return recommendHtmlPptImageTemplateId(page);
  return getInfographicNoteTemplate(raw) ? raw : recommendHtmlPptImageTemplateId(page);
}

/** 组装单页插图 prompt：layoutPromptEn + 内容锁定 + 页内正文（16:9 PPT） */
export function buildHtmlPptSlideImagePrompt(input: HtmlPptSlideImagePromptInput): string {
  const page = input.page;
  const resolvedId = resolveHtmlPptImageTemplateId(input.templateId, page);
  const t = getInfographicNoteTemplate(resolvedId);
  const subject = String(page.title || page.themeTitle || input.deckTitle || "用户主题").trim().slice(0, 80);
  const userCopy = pageContextText(page, input.deckTitle);

  const layoutEn =
    t?.layoutPromptEn.replace(/--ar\s+3:4/gi, "--ar 16:9") ||
    `LAYOUT ONLY — clean 16:9 horizontal presentation hero about the USER TOPIC. Large focal metaphor, sparse labels, high legibility. No sample brands. --ar 16:9`;

  return [
    `【动效PPT·单页插图·${t?.labelZh || "百科信息图"}·仅版式】`,
    t?.blurbZh || "清晰大图示意，服务投屏可读",
    PPT_ASPECT_NOTE,
    SIMPLE_HERO_ZH,
    styleGuideZh(input.styleId),
    INFOGRAPHIC_LAYOUT_META_ZH.replace(/3:4/g, "16:9（幻灯片横版）").replace(
      /高密度/g,
      "适中密度",
    ),
    CONTENT_LOCK_ZH,
    `海报主标题应贴近：${subject}`,
    `Layout prompt (style only):\n${layoutEn}`,
    "",
    "【本页内容·唯一内容来源】",
    userCopy,
  ].join("\n");
}
