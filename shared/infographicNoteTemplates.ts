/**
 * HB V1 · 百科级信息可视化图文模板（3:4）
 * 模板只锁定版式/构图/信息密度风格；禁止内置品牌、历史案例或样例主体。
 * 实际主题一律来自用户粘贴正文。
 */

export type InfographicHeroMode = "exploded" | "split" | "hub" | "timeline";

export const INFOGRAPHIC_HERO_MODE_ORDER: readonly {
  id: InfographicHeroMode;
  labelZh: string;
}[] = [
  { id: "exploded", labelZh: "拆解标注" },
  { id: "timeline", labelZh: "流程时间轴" },
  { id: "hub", labelZh: "枢纽辐射" },
  { id: "split", labelZh: "左右对比" },
] as const;

export type InfographicNoteTemplate = {
  id: string;
  labelZh: string;
  blurbZh: string;
  heroMode: InfographicHeroMode;
  /** 纯版式/风格英文指令（无品牌、无历史案例、无固定样例主体） */
  layoutPromptEn: string;
  aspect: "3:4";
};

/** 后台版式元结构（不对用户展示） */
export const INFOGRAPHIC_LAYOUT_META_ZH = `【信息可视化·版式元结构·仅后台】
SECTION 1：百科全书式 3:4 信息海报（不是随手照片、不是人物宣传照）。
SECTION 2：按所选版式构图（拆解 / 时间轴 / 枢纽 / 左右对比），视觉主体必须来自用户正文主题。
SECTION 3：纹理底 + 半透明示意图层 + 网格/线稿氛围，消除廉价感。
SECTION 4：P.A.M.S. 高密度信息层——Pathways 标注线 · Annotations 微文字块 · Magnifiers 放大镜特写 · Specs 底部数据条。
SECTION 5：竖版 3:4；锐利对焦；专业信息设计光影；禁止无关品牌 logo 与模板样例主体。` as const;

const CONTENT_LOCK_ZH = `【内容锁定·强制】
1. 只可视化「用户正文」里的主题、概念、流程与结论；禁止换成其他公司/品牌/文物/历史案例。
2. 海报主标题优先取用户正文首个标题或核心命题；图中文字概括用户要点，不得编造无关实体名。
3. 模板只提供构图与信息密度风格，不提供题材。`;

export const INFOGRAPHIC_NOTE_TEMPLATES: readonly InfographicNoteTemplate[] = [
  {
    id: "infographic_material_lab",
    labelZh: "微观拆解放大镜",
    blurbZh: "中心主体爆炸拆解 + 局部放大镜 + 材料/模块标注（版式）",
    heroMode: "exploded",
    aspect: "3:4",
    layoutPromptEn: `LAYOUT ONLY — encyclopedic 3:4 infographic poster. Hero: hyper-realistic exploded-view centerpiece of the USER TOPIC with microscope-portal callouts on key modules. Atmosphere: deep charcoal textured canvas + low-opacity schematic overlays. Hyper-dense P.A.M.S. annotation network, circular magnifiers, bottom specs strip. No brand names, no sample products. Octane/Unreal editorial quality, volumetric lighting, 4K. --ar 3:4`,
  },
  {
    id: "infographic_evolution_timeline",
    labelZh: "纵向流程时间轴",
    blurbZh: "竖向时间/阶段刻度 + 节点模块排列（版式）",
    heroMode: "timeline",
    aspect: "3:4",
    layoutPromptEn: `LAYOUT ONLY — encyclopedic 3:4 vertical infographic. Hero: precise vertical chronological / staged timeline of the USER TOPIC milestones on a measurement scale. Atmosphere: deep textured dark canvas + low-opacity blueprint watermarks. Fine hairline annotations, era/stage modules, magnifying inserts, bottom structured data bar. No brand history samples. Museum-editorial lighting, 4K. --ar 3:4`,
  },
  {
    id: "infographic_business_ecosystem",
    labelZh: "中心枢纽辐射图",
    blurbZh: "中央枢纽 + 板块向外辐射连线（版式）",
    heroMode: "hub",
    aspect: "3:4",
    layoutPromptEn: `LAYOUT ONLY — encyclopedic 3:4 infographic. Hero: central architecture hub/nexus of the USER TOPIC with major modules radiating outward, modern tech editorial aesthetic, dramatic volumetric lighting. Rich schematic background. Annotation network, iconized division modules, magnifiers on key nodes, bottom specs strip. Do NOT invent corporate brands or unrelated ecosystems. 4K. --ar 3:4`,
  },
  {
    id: "infographic_rival_showdown",
    labelZh: "左右对半对比",
    blurbZh: "左右分屏镜像对比 + 参数对照条（版式）",
    heroMode: "split",
    aspect: "3:4",
    layoutPromptEn: `LAYOUT ONLY — encyclopedic 3:4 infographic. Hero: split-screen fusion comparing two sides / options / stages from the USER TOPIC with mirrored detail callouts. High-contrast dark technical canvas. Comparison callouts, parameter tables, magnifiers, dual-column bottom specs. No sample rival brands. Octane/Unreal aesthetic, 4K. --ar 3:4`,
  },
  {
    id: "infographic_heritage_craft",
    labelZh: "工艺细节标注",
    blurbZh: "工艺质感中心件 + 工具/细节引出线（版式）",
    heroMode: "exploded",
    aspect: "3:4",
    layoutPromptEn: `LAYOUT ONLY — encyclopedic 3:4 infographic. Hero: craftsmanship-detail centerpiece for the USER TOPIC with tool/process callouts and material close-ups (metaphorical if topic is abstract). Warm deep textured canvas + archival sketch watermarks. P.A.M.S. annotation network, process chips, magnifiers on critical details, bottom craft-specs strip. No luxury-brand case studies. Museum editorial lighting, 4K. --ar 3:4`,
  },
  {
    id: "infographic_structure_deconstruct",
    labelZh: "结构层解构",
    blurbZh: "层级/结构爆炸视图 + 纹样或模块分析（版式）",
    heroMode: "exploded",
    aspect: "3:4",
    layoutPromptEn: `LAYOUT ONLY — encyclopedic 3:4 infographic. Hero: hyper-detailed structural deconstruction / exploded layered architecture of the USER TOPIC. Dark museum-editorial canvas with rubbing-like pattern watermarks. Inscription-style annotations, motif/module magnifiers, stage strip, material-or-metric analysis specs. No ancient-artifact or dynasty samples unless user text explicitly requires them. Documentary quality, 4K. --ar 3:4`,
  },
];

/** 旧 id 兼容：古代器物 → 结构层解构 */
const TEMPLATE_ID_ALIASES: Record<string, string> = {
  infographic_ancient_artifact: "infographic_structure_deconstruct",
};

export function listInfographicTemplatesByMode(): Array<{
  mode: (typeof INFOGRAPHIC_HERO_MODE_ORDER)[number];
  items: InfographicNoteTemplate[];
}> {
  return INFOGRAPHIC_HERO_MODE_ORDER.map((mode) => ({
    mode,
    items: INFOGRAPHIC_NOTE_TEMPLATES.filter((t) => t.heroMode === mode.id),
  })).filter((g) => g.items.length > 0);
}

export function getInfographicNoteTemplate(id: string): InfographicNoteTemplate | null {
  const resolved = TEMPLATE_ID_ALIASES[id] || id;
  return INFOGRAPHIC_NOTE_TEMPLATES.find((t) => t.id === resolved) || null;
}

/** 从用户正文提取短标题（用于海报主标题，不回落到样例品牌） */
export function extractInfographicSubjectFromUserCopy(userCopy: string, overrideTitle?: string): string {
  const override = String(overrideTitle || "").trim();
  if (override) return override.slice(0, 80);
  const text = String(userCopy || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "用户主题";
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 80);
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) || "";
  return firstLine.replace(/^[#>*\-\d.\s]+/, "").slice(0, 80) || "用户主题";
}

/**
 * 纯版式填充（测试/调试用）。正式生图请用 composeInfographicScriptContext。
 */
export function fillInfographicTemplatePrompt(templateId: string, subject: string): string {
  const t = getInfographicNoteTemplate(templateId);
  const sub = String(subject || "").trim() || "用户主题";
  if (!t) {
    return [
      INFOGRAPHIC_LAYOUT_META_ZH,
      CONTENT_LOCK_ZH,
      "",
      `主题：${sub}`,
      `Prompt: LAYOUT ONLY — encyclopedic 3:4 hub infographic about "${sub}". No sample brands. --ar 3:4`,
    ].join("\n");
  }
  return [
    INFOGRAPHIC_LAYOUT_META_ZH,
    CONTENT_LOCK_ZH,
    "",
    `主题：${sub}`,
    `Prompt: ${t.layoutPromptEn}`,
    `User topic title: ${sub}`,
  ].join("\n");
}

/**
 * 后台注入块：版式 + 用户正文。前端 textarea 只应保留用户正文。
 */
export function composeInfographicScriptContext(opts: {
  templateId: string;
  userCopy: string;
  titleOverride?: string;
  maxLen?: number;
}): string {
  const t = getInfographicNoteTemplate(opts.templateId);
  const userCopy = String(opts.userCopy || "").trim();
  const subject = extractInfographicSubjectFromUserCopy(userCopy, opts.titleOverride);
  const maxLen = Math.max(2000, Math.min(12000, opts.maxLen ?? 12000));
  if (!t) return userCopy.slice(0, maxLen);

  const block = [
    `【图文可视化模板·${t.labelZh}·仅版式】`,
    t.blurbZh,
    `画幅：${t.aspect}`,
    INFOGRAPHIC_LAYOUT_META_ZH,
    CONTENT_LOCK_ZH,
    `海报主标题应贴近：${subject}`,
    `Layout prompt (style only):\n${t.layoutPromptEn}`,
    "",
    "【用户正文·唯一内容来源】",
    userCopy,
  ].join("\n");

  return block.slice(0, maxLen);
}

/** @deprecated 使用 composeInfographicScriptContext；保留以免旧调用断裂 */
export function buildInfographicTemplateInjectBlock(templateId: string, subject?: string): string {
  const t = getInfographicNoteTemplate(templateId);
  if (!t) return "";
  return composeInfographicScriptContext({
    templateId,
    userCopy: subject?.trim() || "（用户未提供正文）",
    titleOverride: subject,
  });
}

/** 兼容旧名 */
export const INFOGRAPHIC_META_SECTIONS_ZH = INFOGRAPHIC_LAYOUT_META_ZH;
export function buildInfographicPromptFromMeta(subjectZh: string, heroMode: InfographicHeroMode): string {
  const subject = String(subjectZh || "用户主题").trim().slice(0, 120);
  const byMode = INFOGRAPHIC_NOTE_TEMPLATES.find((t) => t.heroMode === heroMode);
  return fillInfographicTemplatePrompt(byMode?.id || "infographic_business_ecosystem", subject);
}
