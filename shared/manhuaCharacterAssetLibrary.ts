/**
 * 漫剧男女主角色资产库（现代都市设定卡）。
 * 来源：Downloads/2026Jul17/CH（设定卡 OCR 结构化；视觉参考路径见 sourceFile）。
 * 五维公式：脸型 + 发型 + 穿搭 + 姿态 + 道具。
 */

export type ManhuaCharacterGender = "female" | "male";

export type ManhuaCharacterTemplate = {
  id: string;
  gender: ManhuaCharacterGender;
  nameZh: string;
  age?: number;
  jobZh: string;
  temperamentTags: string[];
  /** 注入角色卡 / 生图的提示词 */
  promptZh: string;
  /** 本机素材文件名（CH 目录） */
  sourceFile: string;
};

/** 浏览器可访问的设定卡预览（含底部正/侧/背三视图），见 client/public/manhua-characters/ */
export function getManhuaCharacterPreviewUrl(id: string): string {
  const key = String(id || "").trim();
  if (!/^char_[fm]_\d+$/.test(key)) return "";
  return `/manhua-characters/${key}.jpg`;
}

/** 角色/场景须统一的画风（示意 A/B/C） */
export type ManhuaArtStyleId = "photoreal" | "cg_drama" | "manga_2d";

export type ManhuaArtStylePreset = {
  id: ManhuaArtStyleId;
  labelZh: string;
  shortZh: string;
  /** 注入角色卡 / 静帧 / 成片的硬约束 */
  promptZh: string;
};

export const MANHUA_ART_STYLE_PRESETS: ManhuaArtStylePreset[] = [
  {
    id: "photoreal",
    labelZh: "A · 仿真人",
    shortZh: "都市情感 / 校园更贴",
    promptZh:
      "画风硬锁：半写实仿真人电影剧照，真实皮肤纹理与发丝，自然光影，非卡通非塑料 CGI；角色与场景同一画风。",
  },
  {
    id: "cg_drama",
    labelZh: "B · CG 漫剧质感",
    shortZh: "仙侠 / 权谋默认",
    promptZh:
      "画风硬锁：半写实二次元国乙立绘质感，韩系厚涂，电影柔光，漫剧成片级 CG；角色与场景同一画风。",
  },
  {
    id: "manga_2d",
    labelZh: "C · 二维漫画",
    shortZh: "轻喜 / 夸张表情",
    promptZh:
      "画风硬锁：清晰二维漫画线稿上色，赛璐璐或轻厚涂，禁止写真摄影质感；角色与场景同一画风。",
  },
];

export const DEFAULT_MANHUA_ART_STYLE_ID: ManhuaArtStyleId = "cg_drama";

export function getManhuaArtStylePreset(id?: string | null): ManhuaArtStylePreset {
  const hit = MANHUA_ART_STYLE_PRESETS.find((p) => p.id === id);
  return hit || MANHUA_ART_STYLE_PRESETS.find((p) => p.id === DEFAULT_MANHUA_ART_STYLE_ID)!;
}

/** 题材 → 画风软推荐（可手改） */
export function recommendManhuaArtStyleFromTopic(topic: string): {
  artStyleId: ManhuaArtStyleId;
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  if (!t) {
    return { artStyleId: DEFAULT_MANHUA_ART_STYLE_ID, reasonZh: "未填题材时默认 CG 漫剧质感（可更换）" };
  }
  if (/漫画|条漫|表情包|轻松|搞笑|日常番|二次元纯/.test(t)) {
    return { artStyleId: "manga_2d", reasonZh: "题材偏轻松漫画向 → 推荐二维" };
  }
  if (/都市|职场|霸总|校园|现实|情感连载|总裁/.test(t) && !/仙侠|玄幻|古风|宫斗|修仙/.test(t)) {
    return { artStyleId: "photoreal", reasonZh: "题材偏都市/校园情感 → 推荐仿真人" };
  }
  if (/仙侠|玄幻|古风|宫斗|修仙|权谋|末日|科幻/.test(t)) {
    return { artStyleId: DEFAULT_MANHUA_ART_STYLE_ID, reasonZh: "题材偏仙侠/权谋/奇幻 → 推荐 CG 漫剧" };
  }
  return { artStyleId: DEFAULT_MANHUA_ART_STYLE_ID, reasonZh: "默认 CG 漫剧质感（可更换）" };
}

/** 选中卡妆造摘要（库无细拆字段时用职业+气质+提示词短句） */
export function formatManhuaCharacterLookSummary(c: ManhuaCharacterTemplate): string {
  const tags = c.temperamentTags.slice(0, 3).join("、");
  const hint = c.promptZh
    .replace(/^半写实二次元[，,。]?/, "")
    .replace(/国乙立绘[^，,]*/g, "")
    .replace(/韩系厚涂[，,]?/g, "")
    .replace(/纯白背景[，,]?/g, "")
    .replace(/电影柔光[，,]?/g, "")
    .replace(/超写实8K[。.]?/g, "")
    .trim();
  const shortHint = hint.length > 42 ? `${hint.slice(0, 42)}…` : hint;
  return [tags ? `${tags}气质` : "", c.jobZh ? `${c.jobZh}造型` : "", shortHint]
    .filter(Boolean)
    .join("；");
}

export const MANHUA_CHARACTER_FORMULA_ZH = "脸型（定轮廓）+ 发型（定气质）+ 穿搭（定身份）+ 姿态（定性格）+ 道具（定职业）";

/** 本机素材根目录提示（不入仓；运行时可选拼接） */
export const MANHUA_CHARACTER_LOCAL_SOURCE_HINT =
  "~/Downloads/2026Jul17/CH";

export const MANHUA_CHARACTER_ASSET_LIBRARY: ManhuaCharacterTemplate[] = [
  {
    id: "char_f_01",
    gender: "female",
    nameZh: "沈清辞",
    age: 26,
    jobZh: "都市精英",
    temperamentTags: ["清冷", "克制", "知性"],
    promptZh: "半写实二次元，国乙立绘质感，韩系厚涂，纯白背景，电影柔光，超写实8K，都市精英大片质感。",
    sourceFile: "微信圖片_20260717074417_2318_558.jpg",
  },
  {
    id: "char_f_02",
    gender: "female",
    nameZh: "顾夜笙",
    age: 28,
    jobZh: "顶级律师合伙人",
    temperamentTags: ["冷静", "疏离"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，电影柔光，心形脸，中长慵懒卷发，酒红丝绒西装裙，冷静疏离气质，超写实8K。",
    sourceFile: "微信圖片_20260717074417_2319_558.jpg",
  },
  {
    id: "char_f_03",
    gender: "female",
    nameZh: "江晚吟",
    age: 24,
    jobZh: "古典钢琴演奏家",
    temperamentTags: ["冷静克制", "高智感", "疏离优雅"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，电影柔光，古典钢琴演奏家，冷静克制高智感，超写实8K。",
    sourceFile: "微信圖片_20260717074419_2320_558.jpg",
  },
  {
    id: "char_f_04",
    gender: "female",
    nameZh: "苏陌",
    age: 25,
    jobZh: "建筑设计师",
    temperamentTags: ["冷静", "专业"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，电影柔光，建筑设计师气质，都市精英，超写实8K。",
    sourceFile: "微信圖片_20260717074419_2321_558.jpg",
  },
  {
    id: "char_f_05",
    gender: "female",
    nameZh: "林知遥",
    age: 25,
    jobZh: "博物馆策展人",
    temperamentTags: ["沉静", "悠远"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，长脸黑长直低马尾，酒红中式立领长裙，沉静悠远气质，超写实8K。",
    sourceFile: "微信圖片_20260717074421_2322_558.jpg",
  },
  {
    id: "char_f_06",
    gender: "female",
    nameZh: "阮清禾",
    age: 23,
    jobZh: "文物修复师",
    temperamentTags: ["细腻", "专注"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，文物修复师，细腻专注气质，超写实8K。",
    sourceFile: "微信圖片_20260717074423_2324_558.jpg",
  },
  {
    id: "char_f_07",
    gender: "female",
    nameZh: "唐若曦",
    age: 26,
    jobZh: "时尚杂志主编",
    temperamentTags: ["冷静睿智", "气场强大", "优雅干练"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，心形脸，黑色中长层次卷发，黑色亮片西装连衣裙，时尚主编，强势优雅冷感气质，超写实8K。",
    sourceFile: "微信圖片_20260717074424_2325_558.jpg",
  },
  {
    id: "char_f_08",
    gender: "female",
    nameZh: "陆听澜",
    age: 27,
    jobZh: "心理医生",
    temperamentTags: ["温和", "洞察"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，心理医生，温和洞察气质，超写实8K。",
    sourceFile: "微信圖片_20260717074424_2326_558.jpg",
  },
  {
    id: "char_f_09",
    gender: "female",
    nameZh: "谢知意",
    age: 27,
    jobZh: "独立策展人",
    temperamentTags: ["文艺", "独立"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，独立策展人，文艺独立气质，超写实8K。",
    sourceFile: "微信圖片_20260717074425_2327_558.jpg",
  },
  {
    id: "char_f_10",
    gender: "female",
    nameZh: "温以宁",
    age: 28,
    jobZh: "外科医生",
    temperamentTags: ["沉稳", "利落"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，长脸盘发，墨绿V领长裙，外科医生沉稳利落，超写实8K。",
    sourceFile: "微信圖片_20260717074426_2328_558.jpg",
  },
  {
    id: "char_f_11",
    gender: "female",
    nameZh: "沈听雪",
    age: 25,
    jobZh: "珠宝设计师",
    temperamentTags: ["冷感", "精致"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，菱形脸长卷发，黑色丝绒吊带开叉长裙，珠宝设计师冷感精致，超写实8K。",
    sourceFile: "微信圖片_20260717074428_2329_558.jpg",
  },
  {
    id: "char_f_12",
    gender: "female",
    nameZh: "顾清晏",
    age: 26,
    jobZh: "外交官翻译",
    temperamentTags: ["冷静从容"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，鹅蛋脸及腰直发，黑色修身西装裙，外交官翻译冷静从容，超写实8K。",
    sourceFile: "微信圖片_20260717074428_2330_558.jpg",
  },
  {
    id: "char_f_13",
    gender: "female",
    nameZh: "姜雪芙",
    age: 27,
    jobZh: "香氛品牌创始人",
    temperamentTags: ["优雅", "品牌感"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，香氛品牌创始人，优雅品牌感，超写实8K。",
    sourceFile: "微信圖片_20260717074429_2331_558.jpg",
  },
  {
    id: "char_f_14",
    gender: "female",
    nameZh: "沈听澜",
    age: 26,
    jobZh: "作曲家",
    temperamentTags: ["文艺冷静"],
    promptZh: "半写实二次元，国乙游戏立绘质感，韩系精致厚涂，纯白极简背景，电影感柔和光影，鹅蛋脸中长卷发，黑色丝质衬衫，作曲家文艺冷静，超写实8K。",
    sourceFile: "微信圖片_20260717074439_2341_558.jpg",
  },
  {
    id: "char_f_15",
    gender: "female",
    nameZh: "谢清辞",
    age: 27,
    jobZh: "调香师",
    temperamentTags: ["优雅清冷"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，调香师优雅清冷，超写实8K。",
    sourceFile: "微信圖片_20260717074445_2346_558.jpg",
  },
  {
    id: "char_m_01",
    gender: "male",
    nameZh: "叶秋声",
    age: 24,
    jobZh: "管弦乐团首席",
    temperamentTags: ["沉静克制"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，管弦乐团首席，沉静克制，小提琴，超写实8K。",
    sourceFile: "微信圖片_20260717074430_2332_558.jpg",
  },
  {
    id: "char_m_02",
    gender: "male",
    nameZh: "傅临渊",
    age: 29,
    jobZh: "集团CEO",
    temperamentTags: ["冷静霸气", "掌控力强", "都市精英"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，电影柔光，方脸男性，黑色高定西装，威士忌杯，都市精英，冷静强势掌控力，超写实8K。",
    sourceFile: "微信圖片_20260717074431_2333_558.jpg",
  },
  {
    id: "char_m_03",
    gender: "male",
    nameZh: "沈倦",
    age: 27,
    jobZh: "刑事律师",
    temperamentTags: ["锐利", "沉着"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，长脸锐利眼神，刑事律师，沉着锐利，超写实8K。",
    sourceFile: "微信圖片_20260717074432_2334_558.jpg",
  },
  {
    id: "char_m_04",
    gender: "male",
    nameZh: "江执",
    age: 26,
    jobZh: "钢琴家",
    temperamentTags: ["优雅", "专注"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，钢琴家，优雅专注，超写实8K。",
    sourceFile: "微信圖片_20260717074433_2335_558.jpg",
  },
  {
    id: "char_m_05",
    gender: "male",
    nameZh: "陆沉",
    age: 30,
    jobZh: "收藏家",
    temperamentTags: ["深沉", "鉴赏"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，收藏家深沉气质，超写实8K。",
    sourceFile: "微信圖片_20260717074434_2336_558.jpg",
  },
  {
    id: "char_m_06",
    gender: "male",
    nameZh: "谢衍",
    age: 28,
    jobZh: "建筑师",
    temperamentTags: ["理性", "凌乱美感"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，圆脸碎发略凌乱，建筑师理性气质，超写实8K。",
    sourceFile: "微信圖片_20260717074435_2337_558.jpg",
  },
  {
    id: "char_m_07",
    gender: "male",
    nameZh: "裴砚",
    age: 25,
    jobZh: "投行分析师",
    temperamentTags: ["利落", "精英"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，心形脸清爽短发，黑色西装酒红领带，投行分析师，超写实8K。",
    sourceFile: "微信圖片_20260717074436_2338_558.jpg",
  },
  {
    id: "char_m_08",
    gender: "male",
    nameZh: "顾延",
    age: 29,
    jobZh: "博物馆馆长",
    temperamentTags: ["沉稳俊雅"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，方脸沉稳俊雅，博物馆馆长，超写实8K。",
    sourceFile: "微信圖片_20260717074437_2339_558.jpg",
  },
  {
    id: "char_m_09",
    gender: "male",
    nameZh: "秦屿",
    age: 27,
    jobZh: "赛车手",
    temperamentTags: ["张扬", "速度感"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，长脸微乱短发，黑色皮夹克酒红高领，赛车手，超写实8K。",
    sourceFile: "微信圖片_20260717074438_2340_558.jpg",
  },
  {
    id: "char_m_10",
    gender: "male",
    nameZh: "陆淮安",
    age: 28,
    jobZh: "外交官",
    temperamentTags: ["锋利", "从容"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，菱形脸短发，黑色双排扣大衣，外交官从容锋利，超写实8K。",
    sourceFile: "微信圖片_20260717074442_2343_558.jpg",
  },
  {
    id: "char_m_11",
    gender: "male",
    nameZh: "江寒",
    age: 24,
    jobZh: "摄影师",
    temperamentTags: ["松弛", "观察"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，圆脸碎发遮眉，摄影师松弛观察感，超写实8K。",
    sourceFile: "微信圖片_20260717074444_2345_558.jpg",
  },
  {
    id: "char_m_12",
    gender: "male",
    nameZh: "程屿",
    age: 30,
    jobZh: "科技公司创始人",
    temperamentTags: ["锋利", "掌控"],
    promptZh: "半写实二次元，国乙立绘，韩系厚涂，纯白背景，方形脸短发，黑色高定西装深灰高领，科技创始人，超写实8K。",
    sourceFile: "微信圖片_20260717074445_2347_558.jpg",
  },
  {
    id: "char_m_13",
    gender: "male",
    nameZh: "顾西洲",
    age: 28,
    jobZh: "古董商",
    temperamentTags: ["沉静神秘"],
    promptZh: "半写实二次元，国乙游戏立绘质感，韩系精致厚涂，纯白极简背景，长脸中长微卷发，墨绿丝绒长袍外套，古董商沉静神秘，超写实8K。",
    sourceFile: "微信圖片_20260717074447_2348_558.jpg",
  },
  {
    id: "char_m_14",
    gender: "male",
    nameZh: "沈默",
    age: 26,
    jobZh: "指挥家",
    temperamentTags: ["冷静沉稳", "艺术权威"],
    promptZh: "半写实动漫，乙女游戏立绘品质，韩国厚涂，纯白简约背景，电影级柔光，椭圆脸，黑色燕尾服酒红领结，指挥棒，冷静沉稳艺术气息，超写实8K。",
    sourceFile: "微信圖片_20260717074448_2349_558.jpg",
  },
];

export function listManhuaCharactersByGender(gender: ManhuaCharacterGender) {
  return MANHUA_CHARACTER_ASSET_LIBRARY.filter((c) => c.gender === gender);
}

export function getManhuaCharacterById(id: string) {
  const key = String(id || "").trim();
  return MANHUA_CHARACTER_ASSET_LIBRARY.find((c) => c.id === key) || null;
}

/** 气质组合预设：任一标签命中即入选 */
export type ManhuaTemperamentPack = {
  id: string;
  labelZh: string;
  tags: string[];
};

export const MANHUA_TEMPERAMENT_PACKS: ManhuaTemperamentPack[] = [
  { id: "cold_elite", labelZh: "清冷精英", tags: ["清冷", "克制", "冷感", "疏离", "冷静", "冷静克制", "优雅清冷"] },
  { id: "soft_art", labelZh: "文艺沉静", tags: ["沉静", "悠远", "细腻", "专注", "文艺", "独立", "文艺冷静", "沉静克制"] },
  { id: "power_aura", labelZh: "强势气场", tags: ["气场强大", "冷静睿智", "优雅干练", "冷静霸气", "掌控力强", "锋利", "掌控", "都市精英"] },
  { id: "sharp_pro", labelZh: "锋利专业", tags: ["锐利", "沉着", "利落", "精英", "专业", "理性", "从容"] },
  { id: "warm_observe", labelZh: "温和观察", tags: ["温和", "洞察", "松弛", "观察", "深沉", "鉴赏"] },
];

export function characterMatchesTemperamentPack(
  c: ManhuaCharacterTemplate,
  pack: ManhuaTemperamentPack | null | undefined,
): boolean {
  if (!pack) return true;
  const tags = c.temperamentTags;
  return pack.tags.some(
    (t) => tags.includes(t) || tags.some((x) => x.includes(t) || t.includes(x)),
  );
}

/** 男女套组：一键选用双人（可带推荐画风） */
export type ManhuaCouplePack = {
  id: string;
  labelZh: string;
  blurbZh: string;
  femaleId: string;
  maleId: string;
  artStyleId?: ManhuaArtStyleId;
};

export const MANHUA_COUPLE_PACKS: ManhuaCouplePack[] = [
  {
    id: "urban_cold",
    labelZh: "都市清冷对峙",
    blurbZh: "沈清辞 × 傅临渊 · 职场强强",
    femaleId: "char_f_01",
    maleId: "char_m_02",
    artStyleId: "photoreal",
  },
  {
    id: "law_duel",
    labelZh: "律政锋芒",
    blurbZh: "顾夜笙 × 沈倦 · 法庭对峙",
    femaleId: "char_f_02",
    maleId: "char_m_03",
    artStyleId: "photoreal",
  },
  {
    id: "piano_echo",
    labelZh: "琴声回响",
    blurbZh: "江晚吟 × 江执 · 古典双人",
    femaleId: "char_f_03",
    maleId: "char_m_04",
    artStyleId: "cg_drama",
  },
  {
    id: "museum_night",
    labelZh: "馆夜低语",
    blurbZh: "林知遥 × 顾延 · 文物与时间",
    femaleId: "char_f_05",
    maleId: "char_m_08",
    artStyleId: "cg_drama",
  },
  {
    id: "fashion_power",
    labelZh: "时尚权柄",
    blurbZh: "唐若曦 × 程屿 · 主编与创始人",
    femaleId: "char_f_07",
    maleId: "char_m_12",
    artStyleId: "photoreal",
  },
  {
    id: "antique_mystery",
    labelZh: "古董迷雾",
    blurbZh: "谢知意 × 顾西洲 · 策展与古董",
    femaleId: "char_f_09",
    maleId: "char_m_13",
    artStyleId: "cg_drama",
  },
  {
    id: "heal_soft",
    labelZh: "温和对照",
    blurbZh: "陆听澜 × 江寒 · 洞察与松弛",
    femaleId: "char_f_08",
    maleId: "char_m_11",
    artStyleId: "photoreal",
  },
  {
    id: "speed_edge",
    labelZh: "锋芒速度",
    blurbZh: "温以宁 × 秦屿 · 利落对张扬",
    femaleId: "char_f_10",
    maleId: "char_m_09",
    artStyleId: "manga_2d",
  },
];

export function getManhuaCouplePackById(id: string): ManhuaCouplePack | null {
  const key = String(id || "").trim();
  return MANHUA_COUPLE_PACKS.find((p) => p.id === key) || null;
}

/** 题材 → 套组软推荐（只高亮，不自动覆盖手选） */
export function recommendManhuaCouplePacksFromTopic(topic: string): {
  packIds: string[];
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  if (!t) return { packIds: [], reasonZh: "" };
  const scored = MANHUA_COUPLE_PACKS.map((p) => {
    const f = getManhuaCharacterById(p.femaleId);
    const m = getManhuaCharacterById(p.maleId);
    const hay = [p.labelZh, p.blurbZh, f?.jobZh, m?.jobZh, ...(f?.temperamentTags || []), ...(m?.temperamentTags || [])]
      .filter(Boolean)
      .join(" ");
    let score = 0;
    for (const hint of TOPIC_TEMPERAMENT_HINTS) {
      if (!hint.keys.some((k) => t.includes(k))) continue;
      const hit = hint.tags.some((tag) => hay.includes(tag));
      if (hit) score += 2;
    }
    if (/律政|律师|法庭/.test(t) && p.id === "law_duel") score += 4;
    if (/钢琴|音乐|古典/.test(t) && p.id === "piano_echo") score += 4;
    if (/博物馆|文物|策展/.test(t) && (p.id === "museum_night" || p.id === "antique_mystery")) score += 3;
    if (/时尚|杂志|主编|创始/.test(t) && p.id === "fashion_power") score += 4;
    if (/古董|悬疑|神秘/.test(t) && p.id === "antique_mystery") score += 4;
    if (/霸总|职场|都市|商战/.test(t) && p.id === "urban_cold") score += 3;
    if (/治愈|温和|甜|恋爱/.test(t) && p.id === "heal_soft") score += 4;
    if (/赛车|速度|张扬|轻松|漫画/.test(t) && p.id === "speed_edge") score += 3;
    return { id: p.id, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const packIds = scored.slice(0, 3).map((x) => x.id);
  if (!packIds.length) return { packIds: [], reasonZh: "" };
  const labels = packIds
    .map((id) => MANHUA_COUPLE_PACKS.find((p) => p.id === id)?.labelZh)
    .filter(Boolean)
    .join(" / ");
  return { packIds, reasonZh: `题材软推套组：${labels}` };
}

export function getManhuaTemperamentPackById(id: string): ManhuaTemperamentPack | null {
  const key = String(id || "").trim();
  return MANHUA_TEMPERAMENT_PACKS.find((p) => p.id === key) || null;
}

/** 收藏导出 JSON（可粘贴回导入） */
export function serializeManhuaFavoriteIds(ids: string[]): string {
  const clean = ids.map(String).filter((id) => Boolean(getManhuaCharacterById(id)));
  return JSON.stringify({ v: 1, kind: "manhua-character-fav", ids: clean }, null, 0);
}

export function parseManhuaFavoriteIds(raw: string): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { ids?: unknown; kind?: string } | unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter((id) => Boolean(getManhuaCharacterById(id)));
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { ids?: unknown }).ids)) {
      return ((parsed as { ids: unknown[] }).ids || [])
        .map(String)
        .filter((id) => Boolean(getManhuaCharacterById(id)));
    }
  } catch {
    /* fall through: comma / newline list */
  }
  return text
    .split(/[\s,，;；\n]+/)
    .map((s) => s.trim())
    .filter((id) => Boolean(getManhuaCharacterById(id)));
}

/** 当前双人选型导出（可粘贴给协作 / 以后导入） */
export function serializeManhuaCoupleSelection(opts: {
  femaleId?: string | null;
  maleId?: string | null;
  artStyleId?: string | null;
}): string {
  const femaleId = String(opts.femaleId || "").trim();
  const maleId = String(opts.maleId || "").trim();
  const artStyleId = String(opts.artStyleId || "").trim() || undefined;
  return JSON.stringify(
    {
      v: 1,
      kind: "manhua-character-couple",
      femaleId: femaleId && getManhuaCharacterById(femaleId) ? femaleId : "",
      maleId: maleId && getManhuaCharacterById(maleId) ? maleId : "",
      artStyleId,
    },
    null,
    0,
  );
}

export function parseManhuaCoupleSelection(raw: string): {
  femaleId: string;
  maleId: string;
  artStyleId?: ManhuaArtStyleId;
} | null {
  try {
    const parsed = JSON.parse(String(raw || "").trim()) as {
      kind?: string;
      femaleId?: unknown;
      maleId?: unknown;
      artStyleId?: unknown;
    };
    if (!parsed || parsed.kind !== "manhua-character-couple") return null;
    const femaleId = String(parsed.femaleId || "");
    const maleId = String(parsed.maleId || "");
    const f = getManhuaCharacterById(femaleId);
    const m = getManhuaCharacterById(maleId);
    if ((!femaleId || !f || f.gender !== "female") && (!maleId || !m || m.gender !== "male")) {
      return null;
    }
    const styleRaw = String(parsed.artStyleId || "");
    const artStyleId = MANHUA_ART_STYLE_PRESETS.some((p) => p.id === styleRaw)
      ? (styleRaw as ManhuaArtStyleId)
      : undefined;
    return {
      femaleId: f?.gender === "female" ? femaleId : "",
      maleId: m?.gender === "male" ? maleId : "",
      artStyleId,
    };
  } catch {
    return null;
  }
}

/**
 * 反差配对：相对当前人选，找气质重叠尽量少、但同题材池仍合理的异性。
 * 重叠越低分越高；完全无交集优先。
 */
export function suggestManhuaContrastPartner(
  characterId: string,
  opts?: { excludeIds?: string[]; limit?: number },
): ManhuaCharacterTemplate[] {
  const base = getManhuaCharacterById(characterId);
  if (!base) return [];
  const targetGender: ManhuaCharacterGender = base.gender === "female" ? "male" : "female";
  const exclude = new Set((opts?.excludeIds || []).map(String));
  const baseTags = base.temperamentTags;
  const limit = Math.max(1, Math.min(opts?.limit || 5, 8));
  return listManhuaCharactersByGender(targetGender)
    .filter((c) => !exclude.has(c.id))
    .map((c) => {
      const overlap = c.temperamentTags.reduce(
        (n, t) => n + (baseTags.includes(t) || baseTags.some((b) => b.includes(t) || t.includes(b)) ? 1 : 0),
        0,
      );
      return { c, overlap };
    })
    .sort(
      (a, b) =>
        a.overlap - b.overlap ||
        Math.abs((a.c.age || 27) - (base.age || 27)) - Math.abs((b.c.age || 27) - (base.age || 27)) ||
        a.c.nameZh.localeCompare(b.c.nameZh, "zh"),
    )
    .slice(0, limit)
    .map((x) => x.c);
}

/** 题材关键词 → 气质标签种子（4.B 自动套用） */
const TOPIC_TEMPERAMENT_HINTS: Array<{ keys: string[]; tags: string[] }> = [
  { keys: ["清冷", "克制", "冷感", "疏离", "高冷"], tags: ["清冷", "克制", "冷感", "疏离", "冷静", "冷静克制", "优雅清冷"] },
  { keys: ["权谋", "宫斗", "翻盘", "宫墙", "步步为营"], tags: ["清冷", "克制", "冷静", "气场强大", "冷静睿智", "掌控"] },
  { keys: ["霸总", "商战", "CEO", "精英", "集团"], tags: ["冷静霸气", "掌控力强", "都市精英", "锋利", "掌控", "利落", "精英"] },
  { keys: ["甜", "治愈", "软萌", "恋爱", "温馨"], tags: ["温和", "洞察", "松弛"] },
  { keys: ["神秘", "古董", "秘境", "悬疑"], tags: ["沉静神秘", "深沉", "沉静", "悠远"] },
  { keys: ["艺术", "钢琴", "指挥", "作曲", "音乐"], tags: ["优雅", "专注", "文艺冷静", "冷静沉稳", "艺术权威", "沉静克制"] },
  { keys: ["医生", "医院", "外科"], tags: ["沉稳", "利落", "温和", "洞察"] },
  { keys: ["时尚", "杂志", "香氛", "珠宝"], tags: ["气场强大", "优雅干练", "冷感", "精致", "优雅", "品牌感"] },
  { keys: ["赛车", "速度", "张扬"], tags: ["张扬", "速度感"] },
  { keys: ["外交", "律师", "投行"], tags: ["冷静从容", "锐利", "沉着", "锋利", "从容", "利落", "精英"] },
];

function scoreCharacterAgainstTopic(c: ManhuaCharacterTemplate, topic: string, seedTags: string[]): number {
  const hay = topic.toLowerCase();
  let score = 0;
  const matched: string[] = [];
  for (const tag of c.temperamentTags) {
    if (hay.includes(tag.toLowerCase())) {
      score += 4;
      matched.push(tag);
    }
    for (const seed of seedTags) {
      if (tag.includes(seed) || seed.includes(tag)) {
        score += 2;
        if (!matched.includes(tag)) matched.push(tag);
      }
    }
  }
  if (hay.includes(c.jobZh.toLowerCase())) score += 3;
  if (hay.includes(c.nameZh)) score += 5;
  return score;
}

export type ManhuaCharacterRecommendResult = {
  femaleId: string | null;
  maleId: string | null;
  female?: ManhuaCharacterTemplate | null;
  male?: ManhuaCharacterTemplate | null;
  reasonZh: string;
  matchedTags: string[];
};

/**
 * 4.B：按题材气质推荐男女主各一名（可更换；无信号时给库内稳定默认）。
 */
export function recommendManhuaCharactersFromTopic(topic?: string): ManhuaCharacterRecommendResult {
  const t = String(topic || "").trim();
  const seedTags: string[] = [];
  for (const hint of TOPIC_TEMPERAMENT_HINTS) {
    if (hint.keys.some((k) => t.includes(k))) {
      for (const tag of hint.tags) {
        if (!seedTags.includes(tag)) seedTags.push(tag);
      }
    }
  }

  const pickBest = (gender: ManhuaCharacterGender): { id: string; score: number; tags: string[] } => {
    const pool = listManhuaCharactersByGender(gender);
    let best = pool[0];
    let bestScore = -1;
    let bestTags: string[] = [];
    for (const c of pool) {
      const s = scoreCharacterAgainstTopic(c, t, seedTags);
      if (s > bestScore) {
        best = c;
        bestScore = s;
        bestTags = c.temperamentTags.filter(
          (tag) =>
            seedTags.some((seed) => tag.includes(seed) || seed.includes(tag)) ||
            t.includes(tag),
        );
      }
    }
    // 无题材命中时：女主偏清冷、男主偏霸总（稳定默认，便于流水线）
    if (bestScore <= 0) {
      if (gender === "female") {
        best = getManhuaCharacterById("char_f_01") || best;
        bestTags = best.temperamentTags.slice(0, 2);
      } else {
        best = getManhuaCharacterById("char_m_02") || best;
        bestTags = best.temperamentTags.slice(0, 2);
      }
    }
    return { id: best.id, score: bestScore, tags: bestTags };
  };

  const f = pickBest("female");
  const m = pickBest("male");
  const female = getManhuaCharacterById(f.id);
  const male = getManhuaCharacterById(m.id);
  const matchedTags = Array.from(new Set([...f.tags, ...m.tags])).slice(0, 6);
  const reasonZh = t
    ? matchedTags.length
      ? `题材偏「${matchedTags.slice(0, 3).join("·")}」线`
      : "按题材气质匹配最接近的一套（可更换）"
    : "未填题材时默认清冷女主 + 都市男主（可更换）";

  return {
    femaleId: f.id,
    maleId: m.id,
    female,
    male,
    reasonZh,
    matchedTags,
  };
}

/**
 * 「同版式生成新人」：竖版设定卡生图提示（上半人像文案区 + 下半 FRONT/SIDE/BACK）。
 * 供画布 image 节点预填；不自动跑 API。
 */
export function buildManhuaCharacterSheetGenPrompt(opts?: {
  characterId?: string | null;
  gender?: ManhuaCharacterGender | null;
  artStyleId?: string | null;
  userHint?: string | null;
}): string {
  const style = getManhuaArtStylePreset(opts?.artStyleId);
  const base = opts?.characterId ? getManhuaCharacterById(opts.characterId) : null;
  const gender: ManhuaCharacterGender =
    base?.gender || (opts?.gender === "male" ? "male" : "female");
  const roleZh = gender === "female" ? "女主" : "男主";
  const seed = base
    ? `以「${base.nameZh}」为气质种子（${base.jobZh}；${base.temperamentTags.join("·")}），生成**新面孔新人**，禁止复刻同一张脸。\n外形锚点：${base.promptZh}`
    : `生成一名都市现代向${roleZh}新人设定卡，气质鲜明、可连载锁脸。`;
  const hint = String(opts?.userHint || "").trim();
  return [
    "生成一张竖版【漫剧角色设定卡】单图（白底或浅灰干净背景，印刷清晰）：",
    "版式硬约束：",
    "1) 上半：半身/胸像人像 + 姓名占位 + 气质标签条 + 妆造短句；",
    "2) 下半：同一人物全身 **FRONT / SIDE / BACK** 三视图并排，比例一致、服装一致、锁脸；",
    "3) 三视图下方可有极简英文标注 FRONT SIDE BACK；禁止水印、禁止真实名人脸。",
    "",
    `【画风】${style.labelZh}`,
    style.promptZh,
    "",
    seed,
    hint ? `\n【用户补充】${hint.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 单卡剪贴板文本（方便粘到外部工具，不烧 token） */
export function buildManhuaCharacterClipboardText(
  id: string,
  opts?: { artStyleId?: string | null },
): string {
  const c = getManhuaCharacterById(id);
  if (!c) return "";
  const style = getManhuaArtStylePreset(opts?.artStyleId);
  const preview = getManhuaCharacterPreviewUrl(c.id);
  return [
    `${c.nameZh}（${c.gender === "female" ? "女主" : "男主"}·${c.jobZh}${c.age ? `·${c.age}岁` : ""}）`,
    `气质：${c.temperamentTags.join("·")}`,
    `画风：${style.labelZh}`,
    style.promptZh,
    `提示词：${c.promptZh}`,
    preview ? `预览图：${preview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 注入角色圣经 / 生图：选中卡的外形+气质+提示词（可选画风硬锁） */
export function buildManhuaCharacterPromptBlock(
  ids: string[],
  opts?: { artStyleId?: string | null },
): string {
  const picked = ids.map(getManhuaCharacterById).filter(Boolean) as ManhuaCharacterTemplate[];
  if (!picked.length) return "";
  const style = getManhuaArtStylePreset(opts?.artStyleId);
  const linesOut = picked.map((c, i) => {
    const tags = c.temperamentTags.join("·");
    const age = c.age ? `${c.age}岁` : "";
    const preview = getManhuaCharacterPreviewUrl(c.id);
    const previewLine = preview ? `\n预览图：${preview}` : "";
    return `${i + 1}. ${c.nameZh}（${c.gender === "female" ? "女主" : "男主"}·${c.jobZh}${age ? "·" + age : ""}）气质：${tags}\n提示词：${c.promptZh}${previewLine}`;
  });
  return `【角色库锚点】\n公式：${MANHUA_CHARACTER_FORMULA_ZH}\n【画风】${style.labelZh}\n${style.promptZh}\n${linesOut.join("\n")}`;
}

