/**
 * 电影级运镜/景别/支撑双语词表（自研精简）。
 * 语义对齐公开 MIT Seedance skill 的「可拍词」思路；禁止导演名/片名。
 */

export type ManhuaCineVocabCategory = "shot_size" | "camera_support" | "camera_move" | "lighting_feel";

export type ManhuaCineVocabEntry = {
  id: string;
  category: ManhuaCineVocabCategory;
  zh: string;
  en: string;
};

export const MANHUA_CINE_VOCAB_CATEGORY_LABEL_ZH: Record<ManhuaCineVocabCategory, string> = {
  shot_size: "景别",
  camera_support: "镜头支撑",
  camera_move: "运镜",
  lighting_feel: "光感",
};

export const MANHUA_CINE_VOCAB_BANK: readonly ManhuaCineVocabEntry[] = [
  { id: "sz_ecu", category: "shot_size", zh: "大特写", en: "extreme close-up" },
  { id: "sz_cu", category: "shot_size", zh: "特写", en: "close-up" },
  { id: "sz_mcu", category: "shot_size", zh: "近景", en: "medium close-up" },
  { id: "sz_ms", category: "shot_size", zh: "中景", en: "medium shot" },
  { id: "sz_ws", category: "shot_size", zh: "全景", en: "wide shot" },
  { id: "sz_ews", category: "shot_size", zh: "大远景", en: "extreme wide shot" },
  { id: "sup_locked", category: "camera_support", zh: "锁机位", en: "locked-off tripod" },
  { id: "sup_handheld", category: "camera_support", zh: "手持微晃", en: "subtle handheld" },
  { id: "sup_gimbal", category: "camera_support", zh: "稳定器", en: "gimbal stabilized" },
  { id: "sup_fpv", category: "camera_support", zh: "穿越机", en: "FPV drone support" },
  { id: "mv_push", category: "camera_move", zh: "推进", en: "slow push-in" },
  { id: "mv_pull", category: "camera_move", zh: "拉远", en: "slow pull-out" },
  { id: "mv_pan", category: "camera_move", zh: "横摇", en: "slow pan" },
  { id: "mv_tilt", category: "camera_move", zh: "俯仰", en: "tilt up/down" },
  { id: "mv_track", category: "camera_move", zh: "侧向跟拍", en: "lateral tracking" },
  { id: "mv_orbit", category: "camera_move", zh: "环绕", en: "soft orbit" },
  { id: "mv_crane", category: "camera_move", zh: "升降", en: "crane up/down" },
  { id: "mv_whip", category: "camera_move", zh: "甩镜", en: "whip pan" },
  { id: "lt_motivated", category: "lighting_feel", zh: "动机光", en: "motivated practical key" },
  { id: "lt_rim", category: "lighting_feel", zh: "轮廓光", en: "thin rim light" },
  { id: "lt_split", category: "lighting_feel", zh: "阴阳脸", en: "high-contrast split lighting" },
  { id: "lt_volumetric", category: "lighting_feel", zh: "体积光", en: "volumetric godrays" },
  { id: "lt_neon", category: "lighting_feel", zh: "霓虹溢色", en: "neon spill" },
];

export function listCineVocabByCategory(cat: ManhuaCineVocabCategory): ManhuaCineVocabEntry[] {
  return MANHUA_CINE_VOCAB_BANK.filter((e) => e.category === cat);
}

export function getCineVocabById(id?: string | null): ManhuaCineVocabEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_CINE_VOCAB_BANK.find((e) => e.id === key) || null;
}

export function formatCineVocabInjectBlock(ids: string[]): string {
  const picked = ids.map(getCineVocabById).filter(Boolean) as ManhuaCineVocabEntry[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【${MANHUA_CINE_VOCAB_CATEGORY_LABEL_ZH[e.category]}】${e.zh} / ${e.en}`,
  );
  return [
    "【电影级可拍词表】",
    "硬规则：成稿只写景别/运镜/光感词；每镜一个主运镜；禁止导演名、片名、「某某风」。",
    "一镜一意图：镜头、灯光、调度服务同一戏剧任务。",
    ...lines,
  ].join("\n");
}
