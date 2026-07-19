/**
 * 服装/道具连续性卡片（自研）。
 * 语义对齐公开 MIT video-studio-skills asset-bible 的连续性锚点思路；无外仓品牌。
 */

export type ManhuaWardrobePropContinuityCard = {
  id: string;
  no: number;
  nameZh: string;
  whenToUseZh: string;
  wardrobeLayers: string[];
  signatureProps: string[];
  materialLocks: string[];
  continuityForbid: string[];
  promptLockEn: string;
};

export const MANHUA_WARDROBE_PROP_CONTINUITY_BANK: readonly ManhuaWardrobePropContinuityCard[] = [
  {
    id: "wpc_01_xianxia_sword",
    no: 1,
    nameZh: "仙侠剑修连续",
    whenToUseZh: "仙门、剑修、御剑线。",
    wardrobeLayers: ["内衬中衣", "外袍开衩", "束腰", "软靴"],
    signatureProps: ["佩剑/剑穗", "玉佩"],
    materialLocks: ["丝麻层叠", "暗纹绣边", "金属剑镡反光一致"],
    continuityForbid: ["现代拉链", "运动鞋", "品牌logo"],
    promptLockEn: "xianxia sword cultivator layers + sword tassel continuity, no modern logos",
  },
  {
    id: "wpc_02_jianghu_dao",
    no: 2,
    nameZh: "江湖刀客连续",
    whenToUseZh: "雨夜江湖、刀客、客栈线。",
    wardrobeLayers: ["旧袍", "护腕", "斗笠可选"],
    signatureProps: ["短刀/刀鞘", "酒葫芦"],
    materialLocks: ["湿布褶皱", "磨损边缘", "皮革护腕色号固定"],
    continuityForbid: ["闪亮新衣", "塑料质感"],
    promptLockEn: "weathered jianghu blade kit, wet fabric wear, fixed leather bracer tone",
  },
  {
    id: "wpc_03_urban_power",
    no: 3,
    nameZh: "都市权谋连续",
    whenToUseZh: "商战、职场、谈判。",
    wardrobeLayers: ["深色西装或大衣", "衬衫", "皮鞋"],
    signatureProps: ["腕表", "文件袋/手机"],
    materialLocks: ["哑光毛料", "金属表扣反光一致"],
    continuityForbid: ["跑鞋", "夸张潮牌字样"],
    promptLockEn: "urban power suit continuity, matte wool, watch/phone props locked",
  },
  {
    id: "wpc_04_red_armor",
    no: 4,
    nameZh: "红甲将军连续",
    whenToUseZh: "边关、将军、出征。",
    wardrobeLayers: ["甲片层", "内衬战袍", "披风"],
    signatureProps: ["长枪/令旗", "腰牌"],
    materialLocks: ["红甲色号", "金属刮痕位置相对固定", "披风破口连续"],
    continuityForbid: ["塑料玩具甲", "现代迷彩"],
    promptLockEn: "red armor general continuity, fixed scar/scratch marks, cape tear locked",
  },
  {
    id: "wpc_05_physician",
    no: 5,
    nameZh: "医者行囊连续",
    whenToUseZh: "药庐、行医、救人线。",
    wardrobeLayers: ["素袍", "布带束发", "围裙可选"],
    signatureProps: ["药囊", "针包", "药瓶"],
    materialLocks: ["棉麻旧化", "药囊绳结位置固定"],
    continuityForbid: ["现代医用白大褂商标", "塑料点滴袋"],
    promptLockEn: "physician kit continuity, herb pouch + needle pack, cotton wear",
  },
  {
    id: "wpc_06_tactical_runner",
    no: 6,
    nameZh: "战术追逃连续",
    whenToUseZh: "动作、穿越、追逃、科幻战甲轻量版。",
    wardrobeLayers: ["贴身战术层", "护具节点", "靴"],
    signatureProps: ["手套", "耳麦/面罩可选"],
    materialLocks: ["哑光机能布", "发光条颜色固定"],
    continuityForbid: ["松垮休闲装突然换色", "品牌运动鞋logo"],
    promptLockEn: "tactical runner suit continuity, matte tech fabric, fixed glow accent color",
  },
  {
    id: "wpc_07_court_phoenix",
    no: 7,
    nameZh: "宫廷凤仪连续",
    whenToUseZh: "女帝、宫廷、宫斗、朝堂仪仗。",
    wardrobeLayers: ["多层宫装礼服", "宽袖", "半透披帛", "曳地裙裾", "凤冠/步摇"],
    signatureProps: ["凤印", "玉圭", "宫灯可选"],
    materialLocks: ["金线织锦色号固定", "朱砂花钿位置一致", "曳地裙裾褶皱语言一致"],
    continuityForbid: ["现代西装", "运动鞋", "甜宠短裙街拍"],
    promptLockEn: "court phoenix gown continuity, fixed gold embroidery + forehead mark, no modern suits",
  },
];

export function getWardrobePropContinuityById(
  id?: string | null,
): ManhuaWardrobePropContinuityCard | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_WARDROBE_PROP_CONTINUITY_BANK.find((e) => e.id === key) || null;
}

export function listWardrobePropContinuity(): readonly ManhuaWardrobePropContinuityCard[] {
  return MANHUA_WARDROBE_PROP_CONTINUITY_BANK;
}

export function buildWardrobePropContinuityInjectBlock(ids: string[]): string {
  const picked = ids
    .map(getWardrobePropContinuityById)
    .filter(Boolean) as ManhuaWardrobePropContinuityCard[];
  if (!picked.length) return "";
  const lines = picked.map((e, i) =>
    [
      `${i + 1}. 【服装道具连续】${e.nameZh}`,
      `   服饰层：${e.wardrobeLayers.join("、")}`,
      `   招牌道具：${e.signatureProps.join("、")}`,
      `   材质锁：${e.materialLocks.join("、")}`,
      `   禁止崩坏：${e.continuityForbid.join("、")}`,
      `   EN: ${e.promptLockEn}`,
    ].join("\n"),
  );
  return [
    "【服装道具连续性】",
    "硬规则：跨镜锁定层次与招牌道具；材质色号连续；禁止外仓品牌与水印描述。",
    ...lines,
  ].join("\n");
}
