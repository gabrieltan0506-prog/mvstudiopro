/**
 * 古风/仙侠男发预设（结构化 prompt，不含社媒原图）。
 * 可独立注入角色卡；若存在设计板 hairstyleZh 可叠加。
 */

export type ManhuaMaleHairstylePreset = {
  id: string;
  no: number;
  nameZh: string;
  structureZh: string;
  accessoryZh: string;
  vibeZh: string;
  promptZh: string;
  promptEn: string;
};

export const MANHUA_MALE_HAIRSTYLE_PRESET_BANK: readonly ManhuaMaleHairstylePreset[] = [
  {
    id: "mhair_01_high_guan",
    no: 1,
    nameZh: "高冠束发",
    structureZh: "顶发高束成冠，侧鬓服帖，后发披落有序",
    accessoryZh: "玉冠或金属发冠",
    vibeZh: "端正威仪",
    promptZh: "高冠束发，顶髻端正，侧鬓干净，后发披落有层次，古风男主威仪。",
    promptEn: "high guan topknot, neat sideburns, layered rear hair, dignified ancient male",
  },
  {
    id: "mhair_02_half_up_ribbon",
    no: 2,
    nameZh: "半束织带",
    structureZh: "上半束起，下半长发披肩，额前碎发轻落",
    accessoryZh: "暗色织带",
    vibeZh: "清俊克制",
    promptZh: "半束长发，暗色织带，额前碎发，肩披长发，清俊克制。",
    promptEn: "half-up long hair with dark ribbon, soft bangs, restrained elegant male",
  },
  {
    id: "mhair_03_loose_ink",
    no: 3,
    nameZh: "散墨长发",
    structureZh: "全披散长发，中分或微偏，发梢微卷",
    accessoryZh: "无冠或单枚发簪",
    vibeZh: "疏离冷感",
    promptZh: "散墨长发全披，中分微偏，发梢微卷，疏离冷感男。",
    promptEn: "loose ink-black long hair, slight center part, cool distant male vibe",
  },
  {
    id: "mhair_04_warrior_braid",
    no: 4,
    nameZh: "战辫束尾",
    structureZh: "两侧细辫收拢，后发高束成尾，利落",
    accessoryZh: "皮绳或铜环",
    vibeZh: "沙场锋利",
    promptZh: "两侧细辫，后发高束战尾，皮绳固定，沙场锋利。",
    promptEn: "side warrior braids into high ponytail, leather cord, battlefield sharpness",
  },
  {
    id: "mhair_05_daoist_knot",
    no: 5,
    nameZh: "道髻短披",
    structureZh: "顶髻小而紧，颈后短披发，鬓角干净",
    accessoryZh: "木簪",
    vibeZh: "清修冷静",
    promptZh: "道髻紧束，颈后短披，木簪，清修冷静。",
    promptEn: "tight daoist topknot, short nape fall, wooden pin, calm cultivator",
  },
  {
    id: "mhair_06_wet_rain",
    no: 6,
    nameZh: "雨湿贴颈",
    structureZh: "湿发贴额贴颈，几缕黏颊，体积感压低",
    accessoryZh: "无",
    vibeZh: "狼狈隐忍",
    promptZh: "雨湿长发贴额贴颈，几缕黏颊，狼狈却隐忍。",
    promptEn: "rain-wet hair stuck to forehead and neck, strands on cheek, restrained hardship",
  },
  {
    id: "mhair_07_silver_streak",
    no: 7,
    nameZh: "银丝间黑",
    structureZh: "黑发为主，鬓角/发丝掺银白",
    accessoryZh: "素冠",
    vibeZh: "沧桑权谋",
    promptZh: "黑发掺银丝，鬓角霜意，素冠，沧桑权谋感。",
    promptEn: "black hair with silver streaks at temples, plain guan, weathered schemer",
  },
  {
    id: "mhair_08_youth_tuft",
    no: 8,
    nameZh: "少年双髻",
    structureZh: "左右小双髻或偏髻，余发较短",
    accessoryZh: "红绳",
    vibeZh: "少年锐气",
    promptZh: "少年双髻，红绳，余发利落，锐气未收。",
    promptEn: "youth twin topknots with red cords, neat fall, sharp youthful energy",
  },
  {
    id: "mhair_09_emperor_crown",
    no: 9,
    nameZh: "帝王冕式",
    structureZh: "极高束冠，发量饱满，鬓角刀削般整齐",
    accessoryZh: "金冠/冕板简化",
    vibeZh: "至尊压迫",
    promptZh: "高冕式束发，发量饱满，鬓角整齐，至尊压迫感。",
    promptEn: "imperial high crown hairstyle, full volume, sharp temples, absolute authority",
  },
  {
    id: "mhair_10_assassin_hood_fall",
    no: 10,
    nameZh: "刺客遮额",
    structureZh: "长发前压遮半额，侧发可掩耳",
    accessoryZh: "黑巾可选",
    vibeZh: "危险低伏",
    promptZh: "长发前压遮额，侧发掩耳，危险低伏。",
    promptEn: "forelock covering brow, side hair veiling ear, low dangerous presence",
  },
  {
    id: "mhair_11_physician_neat",
    no: 11,
    nameZh: "医者齐束",
    structureZh: "中高束，发尾收进发带，干净无散丝",
    accessoryZh: "素布发带",
    vibeZh: "温柔专业",
    promptZh: "中高束发，素布发带收尾，无散丝，医者清净。",
    promptEn: "mid-high neat bun with cloth band, no flyaways, gentle physician neatness",
  },
  {
    id: "mhair_12_wild_wind",
    no: 12,
    nameZh: "狂风乱披",
    structureZh: "披发散开被风掀起，体积大、动态强",
    accessoryZh: "无",
    vibeZh: "失控爆发",
    promptZh: "狂风乱披长发，体积大，动态强，情绪爆发前兆。",
    promptEn: "wind-tossed wild loose hair, high volume motion, pre-eruption emotion",
  },
  {
    id: "mhair_13_side_knot",
    no: 13,
    nameZh: "偏髻侠气",
    structureZh: "发髻偏一侧，另一侧长发披落",
    accessoryZh: "短簪",
    vibeZh: "江湖不羁",
    promptZh: "偏髻，一侧披发，短簪，江湖不羁。",
    promptEn: "offset side knot with opposite loose fall, short pin, free jianghu air",
  },
  {
    id: "mhair_14_shaved_top",
    no: 14,
    nameZh: "剃顶辫尾",
    structureZh: "顶侧利落，后辫或短尾（古风幻想可）",
    accessoryZh: "铜环",
    vibeZh: "边军粗砺",
    promptZh: "顶侧利落，后短辫尾，铜环，边军粗砺。",
    promptEn: "neat shaved sides with rear short braid, copper ring, frontier grit",
  },
  {
    id: "mhair_15_phoenix_long",
    no: 15,
    nameZh: "凤纹长披",
    structureZh: "极长披发，发中隐暗纹发饰",
    accessoryZh: "暗纹发饰",
    vibeZh: "华贵危险",
    promptZh: "极长披发，暗纹发饰，华贵而危险。",
    promptEn: "ultra-long flowing hair with subtle ornate clip, luxurious danger",
  },
  {
    id: "mhair_16_frost_tips",
    no: 16,
    nameZh: "霜梢束发",
    structureZh: "束发为主，发梢带浅霜色",
    accessoryZh: "白玉簪",
    vibeZh: "仙门清冷",
    promptZh: "束发，发梢浅霜色，白玉簪，仙门清冷。",
    promptEn: "bound hair with frosted tips, white jade pin, cold immortal sect air",
  },
  {
    id: "mhair_17_messy_after_battle",
    no: 17,
    nameZh: "战后散束",
    structureZh: "原束发部分散开，碎发黏汗",
    accessoryZh: "歪斜发冠",
    vibeZh: "疲惫未败",
    promptZh: "战后发冠歪斜，束发散落，汗湿碎发，疲惫未败。",
    promptEn: "askew guan after battle, half-loose sweaty strands, exhausted but unbroken",
  },
  {
    id: "mhair_18_scholar_soft",
    no: 18,
    nameZh: "书生软束",
    structureZh: "低束或软髻，发丝柔软，额发轻",
    accessoryZh: "竹簪",
    vibeZh: "温润藏锋",
    promptZh: "书生软束，竹簪，额发轻，温润藏锋。",
    promptEn: "soft scholarly low knot, bamboo pin, light bangs, gentle blade-in-sheath",
  },
];

export function getMaleHairstylePresetById(id?: string | null): ManhuaMaleHairstylePreset | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_MALE_HAIRSTYLE_PRESET_BANK.find((e) => e.id === key) || null;
}

export function listMaleHairstylePresets(): readonly ManhuaMaleHairstylePreset[] {
  return MANHUA_MALE_HAIRSTYLE_PRESET_BANK;
}

export function formatMaleHairstylePresetBrief(preset: ManhuaMaleHairstylePreset): string {
  return [
    `【男发预设】${preset.nameZh}（${preset.id}）`,
    `结构：${preset.structureZh}`,
    `饰物：${preset.accessoryZh || "无"}`,
    `气质：${preset.vibeZh}`,
    `提示：${preset.promptZh}`,
    `EN: ${preset.promptEn}`,
  ].join("\n");
}

export function buildMaleHairstyleInjectBlock(ids: string[]): string {
  const picked = ids.map(getMaleHairstylePresetById).filter(Boolean) as ManhuaMaleHairstylePreset[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) => `${i + 1}. ${e.nameZh}：${e.promptZh}\n   EN: ${e.promptEn}`,
  );
  return [
    "【男发预设库】",
    "硬规则：锁发型结构与饰物，勿写入品牌水印或外仓截图描述。",
    ...lines,
  ].join("\n");
}
