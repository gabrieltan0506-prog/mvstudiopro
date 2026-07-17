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

/** 注入角色圣经 / 生图：选中卡的外形+气质+提示词 */
export function buildManhuaCharacterPromptBlock(ids: string[]): string {
  const picked = ids.map(getManhuaCharacterById).filter(Boolean) as ManhuaCharacterTemplate[];
  if (!picked.length) return "";
  const linesOut = picked.map((c, i) => {
    const tags = c.temperamentTags.join("·");
    const age = c.age ? `${c.age}岁` : "";
    return `${i + 1}. ${c.nameZh}（${c.gender === "female" ? "女主" : "男主"}·${c.jobZh}${age ? "·" + age : ""}）气质：${tags}\n提示词：${c.promptZh}`;
  });
  return `【角色库锚点】\n公式：${MANHUA_CHARACTER_FORMULA_ZH}\n${linesOut.join("\n")}`;
}

