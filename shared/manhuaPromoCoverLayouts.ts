/**
 * 漫剧宣发封面构图模板（含人景双重曝光）。
 * 不进六栏主分镜；只服务封面/海报节点。禁止入库带水印原图。
 */

export type ManhuaPromoCoverLayout = {
  id: string;
  no: number;
  nameZh: string;
  compositionZh: string;
  whenToUseZh: string;
  promptLockEn: string;
  aspectHint: "9:16" | "3:4" | "1:1";
};

export const MANHUA_PROMO_COVER_LAYOUTS: readonly ManhuaPromoCoverLayout[] = [
  {
    id: "promo_01_silhouette_landscape",
    no: 1,
    nameZh: "剪影叠山河",
    compositionZh: "人物侧脸/全身剪影为蒙版，内部填充山河云海，边缘清晰可读。",
    whenToUseZh: "仙侠世界观海报、系列主视觉。",
    promptLockEn: "double exposure: character silhouette filled with epic landscape, crisp edge",
    aspectHint: "3:4",
  },
  {
    id: "promo_02_face_city_night",
    no: 2,
    nameZh: "脸叠夜城",
    compositionZh: "半透明面中隐夜城灯火与街道，眼神区保持清晰。",
    whenToUseZh: "都市权谋、夜戏系列宣发。",
    promptLockEn: "face double-exposed with night city lights, eyes stay sharp",
    aspectHint: "9:16",
  },
  {
    id: "promo_03_profile_interior",
    no: 3,
    nameZh: "侧脸叠室内戏",
    compositionZh: "侧脸轮廓内叠关键室内场景（议事厅/药庐/雨巷），叙事一目了然。",
    whenToUseZh: "单集宣发、人物×场景绑定。",
    promptLockEn: "profile silhouette filled with narrative interior scene",
    aspectHint: "3:4",
  },
  {
    id: "promo_04_couple_split_exposure",
    no: 4,
    nameZh: "双人分曝",
    compositionZh: "左右各一剪影，中间叠战火或花海，关系张力居中。",
    whenToUseZh: "CP 向、对立合作。",
    promptLockEn: "split double exposure couple silhouettes, shared narrative core",
    aspectHint: "3:4",
  },
  {
    id: "promo_05_armor_battlefield",
    no: 5,
    nameZh: "甲胄叠战场",
    compositionZh: "铠甲胸甲区域叠千军/烽火，面部实体清晰。",
    whenToUseZh: "将军线、边关线。",
    promptLockEn: "armor torso double-exposed with battlefield, face solid and clear",
    aspectHint: "9:16",
  },
  {
    id: "promo_06_hand_prop_reveal",
    no: 6,
    nameZh: "手中物叙事曝",
    compositionZh: "握物手特写为前景实体，背景/剪影区叠完整故事场景。",
    whenToUseZh: "道具驱动宣发、悬念预告。",
    promptLockEn: "hand+prop solid foreground, background double-exposure narrative scene",
    aspectHint: "1:1",
  },
  {
    id: "promo_07_eye_world",
    no: 7,
    nameZh: "瞳中世界",
    compositionZh: "大特写眼睛，瞳孔内嵌微缩场景或人物命运画面。",
    whenToUseZh: "高概念海报、悬疑预告。",
    promptLockEn: "extreme eye CU with miniature world inside pupil, editorial poster",
    aspectHint: "1:1",
  },
  {
    id: "promo_08_back_to_destiny",
    no: 8,
    nameZh: "背影叠宿命",
    compositionZh: "背影实体清晰，天空/披风区域叠过去与未来双场景。",
    whenToUseZh: "启程、流放、终章预告。",
    promptLockEn: "back figure solid, sky/cape region double-exposes past and future",
    aspectHint: "9:16",
  },
];

export function getPromoCoverLayoutById(id?: string | null): ManhuaPromoCoverLayout | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_PROMO_COVER_LAYOUTS.find((e) => e.id === key) || null;
}

export function listPromoCoverLayouts(): readonly ManhuaPromoCoverLayout[] {
  return MANHUA_PROMO_COVER_LAYOUTS;
}

export function buildPromoCoverPrompt(layout: ManhuaPromoCoverLayout, opts?: {
  subjectZh?: string;
  sceneZh?: string;
}): string {
  const subject = String(opts?.subjectZh || "").trim() || "主角人物";
  const scene = String(opts?.sceneZh || "").trim() || "叙事场景";
  return [
    `宣发封面构图「${layout.nameZh}」。`,
    layout.compositionZh,
    `主体：${subject}。内景/叠化内容：${scene}。`,
    "海报级构图；文字区留白可选；禁止品牌水印与平台角标。",
    `EN lock: ${layout.promptLockEn}. Aspect ${layout.aspectHint}.`,
  ].join(" ");
}

export function buildPromoCoverInjectBlock(ids: string[]): string {
  const picked = ids.map(getPromoCoverLayoutById).filter(Boolean) as ManhuaPromoCoverLayout[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【宣发构图】${e.nameZh}：${e.compositionZh}\n   EN: ${e.promptLockEn} · ${e.aspectHint}`,
  );
  return [
    "【漫剧宣发封面构图】",
    "硬规则：仅用于封面/海报节点，不改写六栏分镜主路径；禁止水印原图描述。",
    ...lines,
  ].join("\n");
}
