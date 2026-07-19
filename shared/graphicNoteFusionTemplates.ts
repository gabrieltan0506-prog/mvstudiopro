/**
 * 图文笔记 · 人景物双重曝光融合子模板。
 * 公式：侧脸容器 + 内景叙事 + 同人小身影 + 物件溢出 + 水彩洇边纸底。
 * 禁止水印原图 / 账号名 / 拍摄教学字。
 */

export type GraphicNoteFusionTemplate = {
  id: string;
  labelZh: string;
  blurbZh: string;
  /** 固定为 fusion，由 infographicNoteTemplates 归组 */
  heroMode: "fusion";
  layoutPromptEn: string;
  aspect: "3:4";
  compositionZh: string;
};

const FUSION_LOCK_EN =
  "double-exposure silhouette container, face-readable profile, narrative landscape fill, mini same-subject figure inside, organic overflow props/flora, watercolor ink-bleed edges, high-key parchment ground, no watermark no logo no UI text";

const FUSION_COMPOSITION_BASE_ZH =
  "人物侧脸胸像作半透明蒙版容器，面部身份清晰；剪影内填充叙事风景与同人小身影；花鸟道具溢出边界；水彩洇边溶于米白纸底；禁止水印与角标。";

function fusionLayout(innerSceneEn: string): string {
  return `LAYOUT ONLY — fine-art 3:4 graphic-note cover. ${FUSION_LOCK_EN}. Inner scene fill: ${innerSceneEn}. Soft facial key on cheek/nose; silhouette edges dissolve into off-white paper. No brand names, no sample influencers. Editorial poster quality. --ar 3:4`;
}

/** 融合类图文模板（heroMode=fusion） */
export const GRAPHIC_NOTE_FUSION_TEMPLATES: readonly GraphicNoteFusionTemplate[] = [
  {
    id: "fusion_coastal_lighthouse",
    labelZh: "海岸灯塔融合",
    blurbZh: "侧脸容器叠海岸灯塔小径；同人远影；水彩洇边",
    heroMode: "fusion",
    aspect: "3:4",
    compositionZh: `${FUSION_COMPOSITION_BASE_ZH}内景偏海岸灯塔与海面帆影。`,
    layoutPromptEn: fusionLayout(
      "coastal cliff path, white lighthouse, sparkling ocean, sailboats, seagulls, rope fence, wildflowers",
    ),
  },
  {
    id: "fusion_chinese_garden",
    labelZh: "中式园林融合",
    blurbZh: "侧脸容器叠亭台池塘；同人踏石；玉兰溢出",
    heroMode: "fusion",
    aspect: "3:4",
    compositionZh: `${FUSION_COMPOSITION_BASE_ZH}内景偏古典园林亭台与池塘。`,
    layoutPromptEn: fusionLayout(
      "classical Chinese garden, hexagonal pavilion, stepping stones on calm pond, yellow magnolia blossoms, soft birds",
    ),
  },
  {
    id: "fusion_ink_mountains",
    labelZh: "水墨山峦融合",
    blurbZh: "侧脸容器叠云海奇峰；亭与小径；金晖破云",
    heroMode: "fusion",
    aspect: "3:4",
    compositionZh: `${FUSION_COMPOSITION_BASE_ZH}内景偏水墨云海与奇峰亭。`,
    layoutPromptEn: fusionLayout(
      "misty ink-wash mountain peaks, cliff pavilion, pine trees, waterfall, sunburst through clouds, tiny walker on stone path",
    ),
  },
  {
    id: "fusion_maple_bridge",
    labelZh: "枫桥庭院融合",
    blurbZh: "侧脸容器叠拱桥溪流；同人桥上；枫叶溢出",
    heroMode: "fusion",
    aspect: "3:4",
    compositionZh: `${FUSION_COMPOSITION_BASE_ZH}内景偏枫叶拱桥与石灯。`,
    layoutPromptEn: fusionLayout(
      "East Asian garden with stone arched bridge over clear stream, pavilion, stone lantern, maple leaves, butterflies",
    ),
  },
  {
    id: "fusion_snow_monastery",
    labelZh: "雪峰寺院融合",
    blurbZh: "侧脸容器叠雪峰寺院；登山者；月夜冷调",
    heroMode: "fusion",
    aspect: "3:4",
    compositionZh: `${FUSION_COMPOSITION_BASE_ZH}内景偏雪峰寺院与月夜山脊。`,
    layoutPromptEn: fusionLayout(
      "snow-capped peaks, cliff monastery, moonlit sky, trekkers on ridge, prayer flags",
    ),
  },
  {
    id: "fusion_glasshouse_garden",
    labelZh: "温室花园融合",
    blurbZh: "侧脸容器叠玻璃温室与睡莲；同人远径；兰花溢出",
    heroMode: "fusion",
    aspect: "3:4",
    compositionZh: `${FUSION_COMPOSITION_BASE_ZH}内景偏玻璃温室与热带花园。`,
    layoutPromptEn: fusionLayout(
      "Victorian glass conservatories, tropical garden path, pond with water lilies, palms, pink orchids, butterflies",
    ),
  },
];

export const FUSION_COMPOSITION_ZH = FUSION_COMPOSITION_BASE_ZH;

export function listGraphicNoteFusionTemplates(): readonly GraphicNoteFusionTemplate[] {
  return GRAPHIC_NOTE_FUSION_TEMPLATES;
}

export function getGraphicNoteFusionTemplate(id?: string | null): GraphicNoteFusionTemplate | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return GRAPHIC_NOTE_FUSION_TEMPLATES.find((t) => t.id === key) || null;
}
