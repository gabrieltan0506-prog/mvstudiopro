/**
 * 电影级运镜/景别/支撑多语言词表。
 * 语义对齐公开 MIT Seedance skill 的「可拍词」思路；禁止导演名/片名。
 */

export type ManhuaCineVocabCategory = "shot_size" | "camera_support" | "camera_move" | "lighting_feel";

export type ManhuaCineVocabLocale = "zh" | "en" | "ja" | "ko" | "es" | "ru";

export type ManhuaCineVocabEntry = {
  id: string;
  category: ManhuaCineVocabCategory;
  zh: string;
  en: string;
  ja: string;
  ko: string;
  es: string;
  ru: string;
};

export const MANHUA_CINE_VOCAB_CATEGORY_LABEL_ZH: Record<ManhuaCineVocabCategory, string> = {
  shot_size: "景别",
  camera_support: "镜头支撑",
  camera_move: "运镜",
  lighting_feel: "光感",
};

export const MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH: Record<ManhuaCineVocabLocale, string> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  ru: "Русский",
};

export const MANHUA_CINE_VOCAB_BANK: readonly ManhuaCineVocabEntry[] = [
  {
    id: "sz_ecu",
    category: "shot_size",
    zh: "大特写",
    en: "extreme close-up",
    ja: "極端クローズアップ",
    ko: "익스트림 클로즈업",
    es: "primerísimo primer plano",
    ru: "сверхкрупный план",
  },
  {
    id: "sz_cu",
    category: "shot_size",
    zh: "特写",
    en: "close-up",
    ja: "クローズアップ",
    ko: "클로즈업",
    es: "primer plano",
    ru: "крупный план",
  },
  {
    id: "sz_mcu",
    category: "shot_size",
    zh: "近景",
    en: "medium close-up",
    ja: "バストショット",
    ko: "미디엄 클로즈업",
    es: "plano medio corto",
    ru: "среднекрупный план",
  },
  {
    id: "sz_ms",
    category: "shot_size",
    zh: "中景",
    en: "medium shot",
    ja: "ミディアムショット",
    ko: "미디엄 샷",
    es: "plano medio",
    ru: "средний план",
  },
  {
    id: "sz_ws",
    category: "shot_size",
    zh: "全景",
    en: "wide shot",
    ja: "ロングショット",
    ko: "와이드 샷",
    es: "plano general",
    ru: "общий план",
  },
  {
    id: "sz_ews",
    category: "shot_size",
    zh: "大远景",
    en: "extreme wide shot",
    ja: "超ロングショット",
    ko: "익스트림 와이드",
    es: "gran plano general",
    ru: "дальний план",
  },
  {
    id: "sup_locked",
    category: "camera_support",
    zh: "锁机位",
    en: "locked-off tripod",
    ja: "固定三脚",
    ko: "고정 삼각대",
    es: "cámara fija en trípode",
    ru: "камера на штативе",
  },
  {
    id: "sup_handheld",
    category: "camera_support",
    zh: "手持微晃",
    en: "subtle handheld",
    ja: "わずかな手持ち揺れ",
    ko: "미세 핸드헬드",
    es: "ligera cámara en mano",
    ru: "лёгкая съёмка с рук",
  },
  {
    id: "sup_gimbal",
    category: "camera_support",
    zh: "稳定器",
    en: "gimbal stabilized",
    ja: "ジンバル安定",
    ko: "짐벌 안정화",
    es: "estabilizador gimbal",
    ru: "стабилизатор",
  },
  {
    id: "sup_fpv",
    category: "camera_support",
    zh: "穿越机",
    en: "FPV drone support",
    ja: "FPVドローン",
    ko: "FPV 드론",
    es: "dron FPV",
    ru: "FPV-дрон",
  },
  {
    id: "mv_push",
    category: "camera_move",
    zh: "推进",
    en: "slow push-in",
    ja: "ゆっくり寄る",
    ko: "천천히 푸시인",
    es: "acercamiento lento",
    ru: "медленный наезд",
  },
  {
    id: "mv_pull",
    category: "camera_move",
    zh: "拉远",
    en: "slow pull-out",
    ja: "ゆっくり引く",
    ko: "천천히 풀아웃",
    es: "alejamiento lento",
    ru: "медленный отъезд",
  },
  {
    id: "mv_pan",
    category: "camera_move",
    zh: "横摇",
    en: "slow pan",
    ja: "ゆっくりパン",
    ko: "슬로우 팬",
    es: "paneo lento",
    ru: "медленный панорамирование",
  },
  {
    id: "mv_tilt",
    category: "camera_move",
    zh: "俯仰",
    en: "tilt up/down",
    ja: "ティルト",
    ko: "틸트",
    es: "tilt vertical",
    ru: "наклон вверх/вниз",
  },
  {
    id: "mv_track",
    category: "camera_move",
    zh: "侧向跟拍",
    en: "lateral tracking",
    ja: "横移動フォロー",
    ko: "측면 트래킹",
    es: "travelling lateral",
    ru: "боковой трекинг",
  },
  {
    id: "mv_orbit",
    category: "camera_move",
    zh: "环绕",
    en: "soft orbit",
    ja: "ゆるい回り込み",
    ko: "부드러운 오빗",
    es: "órbita suave",
    ru: "мягкий облёт",
  },
  {
    id: "mv_crane",
    category: "camera_move",
    zh: "升降",
    en: "crane up/down",
    ja: "クレーン昇降",
    ko: "크레인 승강",
    es: "grúa arriba/abajo",
    ru: "кран вверх/вниз",
  },
  {
    id: "mv_whip",
    category: "camera_move",
    zh: "甩镜",
    en: "whip pan",
    ja: "ウィップパン",
    ko: "휩 팬",
    es: "paneo látigo",
    ru: "резкий панорамирование",
  },
  {
    id: "lt_motivated",
    category: "lighting_feel",
    zh: "动机光",
    en: "motivated practical key",
    ja: "動機のある実務光",
    ko: "동기화된 실용광",
    es: "luz práctica motivada",
    ru: "мотивированный практический ключ",
  },
  {
    id: "lt_rim",
    category: "lighting_feel",
    zh: "轮廓光",
    en: "thin rim light",
    ja: "細いリム光",
    ko: "얇은 림라이트",
    es: "luz de canto fina",
    ru: "тонкий контровой свет",
  },
  {
    id: "lt_split",
    category: "lighting_feel",
    zh: "阴阳脸",
    en: "high-contrast split lighting",
    ja: "スプリットライティング",
    ko: "스플릿 라이팅",
    es: "luz partida de alto contraste",
    ru: "контрастный сплит-свет",
  },
  {
    id: "lt_volumetric",
    category: "lighting_feel",
    zh: "体积光",
    en: "volumetric godrays",
    ja: "ボリューム光",
    ko: "볼륨 광선",
    es: "rayos volumétricos",
    ru: "объёмные лучи",
  },
  {
    id: "lt_neon",
    category: "lighting_feel",
    zh: "霓虹溢色",
    en: "neon spill",
    ja: "ネオンの色溢れ",
    ko: "네온 스필",
    es: "derrame de neón",
    ru: "неоновое свечение",
  },
];

export function listCineVocabByCategory(cat: ManhuaCineVocabCategory): ManhuaCineVocabEntry[] {
  return MANHUA_CINE_VOCAB_BANK.filter((e) => e.category === cat);
}

export function getCineVocabById(id?: string | null): ManhuaCineVocabEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_CINE_VOCAB_BANK.find((e) => e.id === key) || null;
}

export function pickCineVocabLabel(
  entry: ManhuaCineVocabEntry,
  locale: ManhuaCineVocabLocale = "zh",
): string {
  return entry[locale] || entry.zh || entry.en;
}

export function formatCineVocabInjectBlock(
  ids: string[],
  locale: ManhuaCineVocabLocale = "zh",
): string {
  const picked = ids.map(getCineVocabById).filter(Boolean) as ManhuaCineVocabEntry[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【${MANHUA_CINE_VOCAB_CATEGORY_LABEL_ZH[e.category]}】${pickCineVocabLabel(e, locale)}${
        locale !== "zh" ? `（${e.zh}）` : ""
      }`,
  );
  return [
    "【电影级可拍词表】",
    `语言：${MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH[locale]}`,
    "硬规则：成稿只写景别/运镜/光感词；每镜一个主运镜；禁止导演名、片名、「某某风」。",
    "一镜一意图：镜头、灯光、调度服务同一戏剧任务。",
    ...lines,
  ].join("\n");
}

/** 全语言对照表（导出/交付用） */
export function formatCineVocabMultilingualTable(ids?: string[]): string {
  const rows = (ids?.length
    ? ids.map(getCineVocabById).filter(Boolean)
    : [...MANHUA_CINE_VOCAB_BANK]) as ManhuaCineVocabEntry[];
  const header = "| id | zh | en | ja | ko | es | ru |";
  const sep = "|---|---|---|---|---|---|---|";
  const body = rows.map(
    (e) => `| ${e.id} | ${e.zh} | ${e.en} | ${e.ja} | ${e.ko} | ${e.es} | ${e.ru} |`,
  );
  return ["# 可拍词表 · 多语言", "", header, sep, ...body, ""].join("\n");
}
