/**
 * HB V1 · 百科级信息可视化图文模板（3:4）
 * 元结构：SECTION1–5 + P.A.M.S. 高密度信息层；主体可替换。
 */

export type InfographicHeroMode = "exploded" | "split" | "hub" | "timeline";

export const INFOGRAPHIC_HERO_MODE_ORDER: readonly {
  id: InfographicHeroMode;
  labelZh: string;
}[] = [
  { id: "exploded", labelZh: "单品拆解" },
  { id: "timeline", labelZh: "发展史" },
  { id: "hub", labelZh: "生态枢纽" },
  { id: "split", labelZh: "对决对比" },
] as const;

export type InfographicNoteTemplate = {
  id: string;
  labelZh: string;
  blurbZh: string;
  heroMode: InfographicHeroMode;
  /** 主体占位说明 */
  subjectHintZh: string;
  /** 可直接套用的英文主提示（含 SUBJECT 占位） */
  promptEn: string;
  aspect: "3:4";
};

/** 五段元结构（改主体即可） */
export const INFOGRAPHIC_META_SECTIONS_ZH = `【信息可视化·五段元结构】
SECTION 1 角色与主题：Massive, encyclopedic 3:4 infographic poster——百科全书式海报，不是随手照片。
SECTION 2 核心视觉主体：单品用 Exploded view；对比用 Split-screen fusion；生态用 Central Hub/Nexus；发展史用线性时间轴。
SECTION 3 环境与画布：Texture background + Low-opacity watermarks + Schematics（图纸/网格/半透明文档层）消除廉价感。
SECTION 4 高密度信息层 P.A.M.S.：Pathways 标注线网 · Annotations 微文字块 · Magnifiers 放大镜特写 · Specs 底部数据条。
SECTION 5 技术规格：Octane/Unreal 级材质光影、volumetric lighting、4K、锐利对焦、专业调色；竖版 3:4。` as const;

export function buildInfographicPromptFromMeta(subjectZh: string, heroMode: InfographicHeroMode): string {
  const subject = String(subjectZh || "主题主体").trim().slice(0, 120);
  const hero =
    heroMode === "exploded"
      ? "Hero: hyper-realistic exploded-view centerpiece of the subject"
      : heroMode === "split"
        ? "Hero: split-screen fusion comparing two rivals of the subject side by side"
        : heroMode === "timeline"
          ? "Hero: vertical chronological timeline of the subject's evolution"
          : "Hero: central hub/nexus of the subject's ecosystem";
  return [
    INFOGRAPHIC_META_SECTIONS_ZH,
    "",
    `主题主体：${subject}`,
    `Prompt: Role & Subject: A massive, encyclopedic 3:4 3D infographic poster about "${subject}". ${hero}. Brand Atmosphere: deep textured background layered with low-opacity schematics and watermark diagrams. Hyper-Dense Information Layer: hundreds of fine annotation hairlines, microscopic text blocks, circular magnifying inserts, bottom tech-specs strip. Technical Specs: Octane render aesthetic, Unreal Engine 5 quality, volumetric lighting, sharp focus, professional color grading, 4K. --ar 3:4`,
  ].join("\n");
}

export const INFOGRAPHIC_NOTE_TEMPLATES: readonly InfographicNoteTemplate[] = [
  {
    id: "infographic_material_lab",
    labelZh: "材质工艺实验室",
    blurbZh: "单品微观拆解 + 材料科学放大镜",
    heroMode: "exploded",
    subjectHintZh: "产品名（如 Leica M11 Titanium）",
    aspect: "3:4",
    promptEn: `Role & Subject: A massive, encyclopedic 3:4 3D infographic poster titled "{{SUBJECT}}: THE ART OF CRAFTSMANSHIP". High-end fusion of electron microscope imagery and luxury product presentation. Hero Centerpiece: hyper-realistic 3D model centrally placed with Microscope Portals revealing materials at atomic level. Brand Atmosphere: deep charcoal textured background layered with material science diagrams and CNC path schematics. Hyper-Dense layer: dense silver annotation network, Material Science Modules, circular magnifying inserts, bottom tech specs strip. Technical Specs: Octane render, Unreal Engine 5 aesthetic, volumetric lighting, 4K. --ar 3:4`,
  },
  {
    id: "infographic_evolution_timeline",
    labelZh: "发展史时间轴",
    blurbZh: "纵向年表 + 代际产品排列",
    heroMode: "timeline",
    subjectHintZh: "品牌/品类发展史（如 Tesla Evolution）",
    aspect: "3:4",
    promptEn: `Role & Subject: A massive, encyclopedic 3:4 vertical 3D infographic poster titled "THE EVOLUTION OF {{SUBJECT}}". Hero: complete linear chronological arrangement of key historical milestones/products on a precise measurement scale running vertically. Brand Atmosphere: deep black textured background with low-opacity vintage engineering documents. Hyper-Dense layer: fine white hairlines to compact text blocks, Era Modules, magnifying insert lenses, bottom structured data bar. Technical Specs: Octane/Unreal quality, volumetric lighting, museum-grade product photography fusion with blueprints, 4K. --ar 3:4`,
  },
  {
    id: "infographic_business_ecosystem",
    labelZh: "业务生态枢纽图",
    blurbZh: "中心枢纽 + 业务板块辐射",
    heroMode: "hub",
    subjectHintZh: "公司/平台生态（如阿里巴巴业务生态）",
    aspect: "3:4",
    promptEn: `Role & Subject: A massive, encyclopedic 3:4 3D infographic poster titled "{{SUBJECT}} 业务生态系统". Hero Centerpiece: central business architecture hub with major divisions radiating outward, modern tech aesthetic, dramatic volumetric lighting. Brand Atmosphere: richly layered schematic background. Hyper-Dense layer: annotation network, division modules with icons, magnifiers on key products, bottom specs strip. Technical Specs: editorial information design masterpiece, 4K. --ar 3:4`,
  },
  {
    id: "infographic_rival_showdown",
    labelZh: "终极对决对比",
    blurbZh: "左右对半拼接 + 参数对决",
    heroMode: "split",
    subjectHintZh: "A vs B（如 Tesla vs Porsche）",
    aspect: "3:4",
    promptEn: `Role & Subject: A massive, encyclopedic 3:4 3D infographic poster titled "{{SUBJECT}} SHOWDOWN". Hero: Split-screen fusion of two rival products/brands with mirrored exploded details. Brand Atmosphere: high-contrast dark canvas with technical overlays. Hyper-Dense layer: comparison callouts, parameter tables, magnifiers, bottom dual-column specs strip. Technical Specs: Octane/Unreal aesthetic, volumetric lighting, 4K. --ar 3:4`,
  },
  {
    id: "infographic_heritage_craft",
    labelZh: "工艺与传承",
    blurbZh: "奢侈品/器物工艺叙事海报",
    heroMode: "exploded",
    subjectHintZh: "品牌工艺主题（如 Hermès 工艺与传承）",
    aspect: "3:4",
    promptEn: `Role & Subject: A massive, encyclopedic 3:4 3D infographic poster titled "{{SUBJECT}}: CRAFT & HERITAGE". Hero: luxury craftsmanship centerpiece with artisan tool callouts and material close-ups. Brand Atmosphere: warm deep textured canvas with archival sketches watermarks. Hyper-Dense layer: P.A.M.S. annotation network, heritage timeline chips, magnifiers on stitching/materials, bottom craft specs strip. Technical Specs: museum editorial lighting, 4K. --ar 3:4`,
  },
  {
    id: "infographic_ancient_artifact",
    labelZh: "古代器物解构",
    blurbZh: "青铜器等文物结构与纹样",
    heroMode: "exploded",
    subjectHintZh: "器物名（如青铜器）",
    aspect: "3:4",
    promptEn: `Role & Subject: A massive, encyclopedic 3:4 3D infographic poster on Chinese ancient artifact "{{SUBJECT}}". Hero: hyper-detailed archaeological reconstruction with exploded ritual vessel structure. Brand Atmosphere: museum dark canvas with rubbing-pattern watermarks. Hyper-Dense layer: inscription annotations, motif magnifiers, dynasty timeline strip, material analysis specs. Technical Specs: documentary museum quality, 4K. --ar 3:4`,
  },
];

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
  return INFOGRAPHIC_NOTE_TEMPLATES.find((t) => t.id === id) || null;
}

export function fillInfographicTemplatePrompt(templateId: string, subject: string): string {
  const t = getInfographicNoteTemplate(templateId);
  const sub = String(subject || "").trim() || "SUBJECT";
  if (!t) return buildInfographicPromptFromMeta(sub, "hub");
  return `${INFOGRAPHIC_META_SECTIONS_ZH}\n\n主题：${sub}\n\n${t.promptEn.replace(/\{\{SUBJECT\}\}/g, sub)}`;
}

export function buildInfographicTemplateInjectBlock(templateId: string, subject?: string): string {
  const t = getInfographicNoteTemplate(templateId);
  if (!t) return "";
  const prompt = fillInfographicTemplatePrompt(templateId, subject || t.subjectHintZh);
  return `【图文可视化模板·${t.labelZh}】\n${t.blurbZh}\n画幅：${t.aspect}\n${prompt}`;
}
