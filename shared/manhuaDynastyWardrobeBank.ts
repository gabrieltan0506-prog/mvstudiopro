/**
 * 朝代服饰提示词库（汉/魏晋/南北朝/隋/唐/宋/元/明/清）。
 * 可选点选：仅当调用方显式传入 dynastyWardrobeIds 时注入。
 * 禁止按题材关键词硬套——玄幻修仙 / CG 漫画等常无历史朝代参照。
 */

export type ManhuaDynastyWardrobeEntry = {
  id: string;
  eraZh: string;
  nameZh: string;
  structureTags: readonly string[];
  paletteZh: string;
  temperamentZh: string;
  promptZh: string;
};

export const MANHUA_DYNASTY_WARDROBE_ORDER: readonly string[] = [
  "dyn_han",
  "dyn_weijin",
  "dyn_nanbeichao",
  "dyn_sui",
  "dyn_tang",
  "dyn_song",
  "dyn_yuan",
  "dyn_ming",
  "dyn_qing",
] as const;

export const MANHUA_DYNASTY_WARDROBE_BANK: readonly ManhuaDynastyWardrobeEntry[] = [
  {
    id: "dyn_han",
    eraZh: "汉",
    nameZh: "汉代深衣曲裾",
    structureTags: ["深衣", "曲裾", "交领右衽", "宽袖", "层叠裙"],
    paletteZh: "米白、浅青、粉里、金线暗纹",
    temperamentZh: "古典端庄，贵族少女气质",
    promptZh:
      "年轻东方女子，汉代贵族，曲裾深衣，交领右衽，宽长袖多层裙摆，米白丝织浅青缘边粉里，薄纱外披，云纹暗花金线绣，腰间玉佩流苏；优雅端庄，写实古装。",
  },
  {
    id: "dyn_weijin",
    eraZh: "魏晋",
    nameZh: "魏晋宽袍飘带",
    structureTags: ["宽袍大袖", "飘带", "薄纱外袍", "云鹤纹"],
    paletteZh: "浅紫、白、银灰",
    temperamentZh: "仙气飘逸，清雅出尘",
    promptZh:
      "年轻东方女子，魏晋风，宽袍大袖飘带，薄纱外袍，浅紫白配色，云鹤纹银绣，银花珠饰发髻；仙气优雅，写实古装。",
  },
  {
    id: "dyn_nanbeichao",
    eraZh: "南北朝",
    nameZh: "南北朝交领层叠",
    structureTags: ["交领窄袖", "轻质层叠裙", "玉坠步摇"],
    paletteZh: "米白、豆沙绿、浅粉",
    temperamentZh: "温婉端庄",
    promptZh:
      "年轻东方女子，南北朝服饰，交领窄袖，轻质层叠裙摆，米白与豆沙绿，玉珠步摇花蔓；古典优雅，温婉端庄。",
  },
  {
    id: "dyn_sui",
    eraZh: "隋",
    nameZh: "隋风高腰襦裙",
    structureTags: ["高腰襦裙", "丝帛披巾", "金花步摇"],
    paletteZh: "桃粉、米色、金绣",
    temperamentZh: "华贵雅韵",
    promptZh:
      "年轻东方女子，隋朝宫廷服饰，高腰襦裙，丝帛披巾，桃粉米色金绣花卉，金花步摇珠旒；优雅端庄，写实古装。",
  },
  {
    id: "dyn_tang",
    eraZh: "唐",
    nameZh: "唐齐胸襦裙广袖",
    structureTags: ["齐胸襦裙", "广袖", "披帛", "牡丹凤凰绣"],
    paletteZh: "正红、金、浅桃",
    temperamentZh: "大唐风华，华贵盛放",
    promptZh:
      "年轻东方女子，唐朝贵女，齐胸襦裙，广袖披帛，正红金绣牡丹凤凰，金步摇珍珠；华美盛唐风华，写实古装。",
  },
  {
    id: "dyn_song",
    eraZh: "宋",
    nameZh: "宋制褙子襦裙",
    structureTags: ["褙子", "直领", "襦裙", "梅竹绣"],
    paletteZh: "米白、淡青",
    temperamentZh: "文人雅致，清雅",
    promptZh:
      "年轻东方女子，宋制襦裙褙子，直领宽袖长裙，米白淡青，梅竹暗绣；文人雅致，清雅气质，写实古装。",
  },
  {
    id: "dyn_yuan",
    eraZh: "元",
    nameZh: "元贵族比甲层袍",
    structureTags: ["比甲", "层叠长袍", "织带流苏"],
    paletteZh: "米白、青碧、金纹",
    temperamentZh: "北方宫廷清雅",
    promptZh:
      "年轻东方女子，元朝贵族，比甲罩长袍，层叠裙摆，米白青碧金纹几何花卉；北方宫廷风，清雅，写实古装。",
  },
  {
    id: "dyn_ming",
    eraZh: "明",
    nameZh: "明制袄裙马面",
    structureTags: ["袄裙", "马面裙", "交领", "织金妆花"],
    paletteZh: "米白、黛蓝、金绣",
    temperamentZh: "端庄华贵",
    promptZh:
      "年轻东方女子，明制袄裙搭配马面裙，交领立缘，黛蓝马面金绣花卉；结构严谨，华贵端庄，写实古装。",
  },
  {
    id: "dyn_qing",
    eraZh: "清",
    nameZh: "清贵妇袍服",
    structureTags: ["立领袍", "宽袖", "花蝶绣", "旗头饰"],
    paletteZh: "米白、浅蓝、金粉绣",
    temperamentZh: "贵妇日常，精致",
    promptZh:
      "年轻东方女子，清朝贵妇常服，立领宽袖长袍，花蝶绣金边，浅蓝内裙，蓝金花簪步摇；精致端庄，写实古装。",
  },
];

const BY_ID = new Map(MANHUA_DYNASTY_WARDROBE_BANK.map((e) => [e.id, e]));

export function getManhuaDynastyWardrobe(id?: string | null): ManhuaDynastyWardrobeEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return BY_ID.get(key) || null;
}

const ERA_PATTERNS: Array<{ re: RegExp; id: string }> = [
  { re: /唐朝|大唐|盛唐|唐制|齐胸襦裙/, id: "dyn_tang" },
  { re: /宋朝|宋制|褙子|文人雅/, id: "dyn_song" },
  { re: /明朝|明制|马面裙/, id: "dyn_ming" },
  { re: /清朝|清制|旗头|贵妇袍/, id: "dyn_qing" },
  { re: /元朝|元制|比甲/, id: "dyn_yuan" },
  { re: /隋朝|隋制|隋风/, id: "dyn_sui" },
  { re: /魏晋|竹林|宽袍大袖/, id: "dyn_weijin" },
  { re: /南北朝/, id: "dyn_nanbeichao" },
  { re: /汉朝|汉代|汉制|曲裾|深衣/, id: "dyn_han" },
];

/** 供点选 UI 检索；禁止用于工厂默认硬套 */
export function recommendDynastyWardrobeFromText(
  raw: string,
): ManhuaDynastyWardrobeEntry | null {
  const t = String(raw || "");
  if (!t) return null;
  for (const { re, id } of ERA_PATTERNS) {
    if (re.test(t)) return BY_ID.get(id) || null;
  }
  return null;
}

export function formatDynastyWardrobeInjectLine(entry: ManhuaDynastyWardrobeEntry): string {
  return `【朝代服饰锚点·${entry.eraZh}】${entry.nameZh}：${entry.promptZh} 配色${entry.paletteZh}；气质${entry.temperamentZh}。跨镜服装结构连续。`;
}

/** 仅当显式传入 id 列表时注入；空列表返回空串 */
export function formatDynastyWardrobeInjectBlock(
  ids: string[] | null | undefined,
): string {
  const picked = (ids || [])
    .map((id) => getManhuaDynastyWardrobe(id))
    .filter(Boolean) as ManhuaDynastyWardrobeEntry[];
  if (!picked.length) return "";
  return picked.map(formatDynastyWardrobeInjectLine).join("\n");
}

/** @deprecated 勿自动拼进 prompt；保留供点选检索预览 */
export function formatRecommendedDynastyWardrobeBlock(raw: string): string {
  const entry = recommendDynastyWardrobeFromText(raw);
  if (!entry) return "";
  return formatDynastyWardrobeInjectLine(entry);
}

/** 古风万能公式口诀（仅在已挂古风原型时旁注；朝代为可选项） */
export const MANHUA_ANCIENT_CHARACTER_FORMULA_ZH =
  "古风角色公式：身份 + 发型 + 服饰结构 + 材质 + 配色 + 饰品 + 气质 + 镜头语言；历史朝代可选（玄幻修仙/CG 漫画勿硬套朝代）。";