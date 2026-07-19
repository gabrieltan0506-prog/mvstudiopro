/**
 * 古风/仙侠角色原型库（7 archetype）。
 * 与都市 MANHUA_CHARACTER_ASSET_LIBRARY 分层；二期可扩战国将军/西域术士。
 */

import {
  buildAncientArchetypePrompt,
  formatAncientDesignBoardBrief,
  getAncientArchetypePreviewUrl,
  type ManhuaAncientDesignBoard,
} from "./manhuaAncientDesignBoard.js";

export type { ManhuaAncientDesignBoard } from "./manhuaAncientDesignBoard.js";
export {
  buildAncientArchetypePrompt,
  formatAncientDesignBoardBrief,
  getAncientArchetypePreviewUrl,
} from "./manhuaAncientDesignBoard.js";

function board(partial: Omit<ManhuaAncientDesignBoard, "promptZh" | "sheetPublicPath"> & {
  promptZh?: string;
}): ManhuaAncientDesignBoard {
  const promptZh = partial.promptZh || buildAncientArchetypePrompt(partial);
  return {
    ...partial,
    promptZh,
    sheetPublicPath: getAncientArchetypePreviewUrl(partial.id),
  };
}

/**
 * 本轮固定 7 槽。扩展位（未开槽）：战国将军、西域术士。
 */
export const MANHUA_ANCIENT_ARCHETYPE_LIBRARY: readonly ManhuaAncientDesignBoard[] = [
  board({
    id: "arch_xianmen_sword_cold",
    nameZh: "清冷仙门剑修",
    lane: "xianxia",
    positioning: ["仙侠男主", "宗门大师兄", "清冷师尊"],
    coreTags: ["清冷", "克制", "孤高", "剑意", "仙门", "无尘"],
    ageBuildZh: "约二十六，修长挺拔，肩窄腰直",
    faceTemperamentZh: "眉目清冷克制，神情孤高，剑意内敛",
    hairstyleZh: "墨色长发高束，白玉发簪固定",
    wardrobeLayers: ["素色内衫", "月白外袍", "雾青披帛", "腰封", "护腕", "软靴"],
    props: ["长剑", "剑穗", "玉佩", "宗门令牌", "白玉发簪"],
    palette: ["月白", "雾青", "银灰", "冷玉", "墨黑"],
    materials: ["轻纱", "暗纹绣", "银线边", "玉石坠饰", "竹叶纹"],
    expressions: ["平静", "垂眸", "凝视", "冷漠", "出剑前"],
    dynamics: ["持剑而立", "负手远眺", "拔剑起势", "衣袂翻飞"],
    accessories: ["白玉发簪", "玉佩", "剑穗", "宗门令牌"],
    atmosphereZh: "仙门山门云雾，冷清干净，无尘烟火",
    promptFormulaKind: "standard",
  }),
  board({
    id: "arch_yaolu_physician",
    nameZh: "药庐温润医者",
    lane: "ancient",
    positioning: ["温柔男二", "隐居先生", "古风医者"],
    coreTags: ["温润", "医者", "隐士", "安静", "草木", "书卷"],
    ageBuildZh: "约二十七，清瘦文雅，肩线柔和",
    faceTemperamentZh: "眉眼温润安静，书卷气，含笑不张扬",
    hairstyleZh: "长发低束丝带，鬓角利落",
    wardrobeLayers: ["素色中衣", "草木纹外袍", "药师腰带", "布鞋"],
    props: ["药囊", "针包", "竹筒", "药瓶", "折扇", "草药篮"],
    palette: ["米白", "草绿", "浅灰", "竹青", "暖玉"],
    materials: ["棉麻布纹", "草药刺绣", "竹筒纹理", "瓷瓶釉色", "玉扣"],
    expressions: ["微笑", "专注", "低头配药", "沉思", "安抚"],
    dynamics: ["捣药", "把脉", "提篮采药", "开扇静立"],
    accessories: ["药囊", "针包", "折扇", "玉扣"],
    atmosphereZh: "药庐草木香，窗明几净，安静书卷",
    promptFormulaKind: "physician",
  }),
  board({
    id: "arch_rain_jianghu_dao",
    nameZh: "雨夜江湖刀客",
    lane: "jianghu",
    positioning: ["江湖浪客", "复仇男主", "灰色侠士"],
    coreTags: ["浪游", "孤胆", "旧伤", "风雨", "复仇", "江湖"],
    ageBuildZh: "约二十五，精悍瘦削，步态警惕",
    faceTemperamentZh: "眉眼阴郁锋利，旧伤感，雨湿发贴颊",
    hairstyleZh: "墨发微乱低束，雨湿贴额",
    wardrobeLayers: ["旧中衣", "深色外袍", "短披风", "绑腿", "护腕", "破损衣摆"],
    props: ["旧刀", "酒葫芦", "木牌", "斗笠", "油纸伞"],
    palette: ["雨青", "灰蓝", "墨黑", "旧褐", "冷白"],
    materials: ["湿布褶皱", "泥点", "刀鞘划痕", "旧皮革", "雨水反光"],
    expressions: ["平视", "回头", "低头", "警惕", "凝视"],
    dynamics: ["扶刀", "回头", "避雨", "拔刀前", "独行背影"],
    accessories: ["木牌", "斗笠", "酒葫芦"],
    atmosphereZh: "雨夜码头灯笼，雾江孤舟，湿冷江湖",
    promptFormulaKind: "weathered",
  }),
  board({
    id: "arch_red_armor_general",
    nameZh: "赤甲王朝将军",
    lane: "gongting",
    positioning: ["权谋男主", "北境统帅", "反派王爷"],
    coreTags: ["冷血", "权谋", "统帅", "压迫", "铁甲", "杀伐"],
    ageBuildZh: "二十六，身长约一八九，肩宽压迫感强",
    faceTemperamentZh: "眉骨高耸，眼神冷血审视，杀伐果决",
    hairstyleZh: "长发高马尾，赤金冠固定",
    wardrobeLayers: ["头冠", "肩甲", "胸甲", "护臂", "腰甲", "战靴", "暗红披风"],
    props: ["长刀", "令牌", "战旗", "军图", "护符"],
    palette: ["玄黑", "暗红", "赤金", "铁灰", "焦棕"],
    materials: ["金属甲片", "皮革绑带", "旧血痕", "暗金纹样", "披风毛边"],
    expressions: ["冷眼", "审视", "怒意", "沉默", "杀伐"],
    dynamics: ["按刀令场", "披风翻飞", "指军图", "登高望远"],
    accessories: ["令牌", "护符", "战旗徽"],
    atmosphereZh: "北境军帐火光，铁血压迫，夜色沉重",
    promptFormulaKind: "standard",
  }),
  board({
    id: "arch_phoenix_empress",
    nameZh: "凤曌女帝",
    lane: "gongting",
    positioning: ["东方神话女帝", "宫廷至尊", "权柄女性"],
    coreTags: ["威仪", "凤凰", "宫廷", "重生", "金绣", "至尊"],
    ageBuildZh: "青年女帝，身姿挺拔华贵",
    faceTemperamentZh: "五官精致冷艳，额间朱砂花钿，威仪自持",
    hairstyleZh: "高髻凤冠，步摇珠络自然垂落",
    wardrobeLayers: ["多层宫装礼服", "宽袖", "半透披帛", "超长曳地裙裾", "金线织锦"],
    props: ["凤印", "玉圭"],
    palette: ["绛红", "宝石蓝", "凝脂白", "鎏金", "朱砂红", "天青蓝", "烟云紫", "琥珀金"],
    materials: ["织锦", "金线绣", "珍珠", "红宝", "蓝宝", "雕金"],
    expressions: ["俯视", "微笑克制", "怒意压下", "垂眸"],
    dynamics: ["袖舞", "披帛翻飞", "转身展背绣", "抬手令退"],
    accessories: ["凤冠", "耳饰", "步摇", "项链", "腰佩"],
    atmosphereZh: "宫廷大殿珠光，金碧压迫，皇权威仪",
    promptFormulaKind: "standard",
  }),
  board({
    id: "arch_forest_phoenix_queen",
    nameZh: "森灵凰后",
    lane: "xianxia",
    positioning: ["森灵凰后", "掌万木生息", "山海神女"],
    coreTags: ["森灵", "凤凰", "万木", "生命", "山海", "神性"],
    ageBuildZh: "青年神女，体态修长，衣袂如林浪",
    faceTemperamentZh: "眉目清丽带神性，翡翠点缀，静中有威",
    hairstyleZh: "繁复金冠嵌翡翠，长发披散夹珠络",
    wardrobeLayers: ["墨绿绛红多层礼袍", "宽袖", "金绣千叶纹", "曳地长裾", "羽肩甲"],
    props: ["木灵杖", "叶纹玉佩"],
    palette: ["墨绿", "松石绿", "绛红", "朱砂红", "鎏金", "象牙白", "青玉", "琥珀棕", "玄金黑"],
    materials: ["刺绣纹样", "鎏金织锦", "纱缎薄纱", "金线纹样", "宝石镶嵌", "玉石雕刻", "珠串流苏"],
    expressions: ["凝望林海", "施法专注", "温柔俯视", "威仪"],
    dynamics: ["袖舞生风", "施法抬手", "转身展翅纹", "踏叶而立"],
    accessories: ["凤冠", "耳饰", "项链", "手饰", "戒指", "腰饰", "流苏佩", "发簪"],
    atmosphereZh: "密林光斑与神殿金雾，生命循环感",
    promptFormulaKind: "standard",
  }),
  board({
    id: "arch_cloud_phoenix_queen",
    nameZh: "云凰女王",
    lane: "xianxia",
    positioning: ["云上仙国女王", "云凰之主", "澄澈至尊"],
    coreTags: ["云霞", "轻羽", "珍珠", "澄澈", "仙国", "柔威"],
    ageBuildZh: "青年女王，体态轻盈华贵",
    faceTemperamentZh: "眉目澄澈柔中带威，珠光映面",
    hairstyleZh: "高髻大金冠，珍珠流苏垂落",
    wardrobeLayers: ["浅蓝白渐变多层长裙", "半透薄纱袖", "金丝羽肩", "腰封", "曳地云裾"],
    props: ["手持法器", "羽杖"],
    palette: ["云白", "月光白", "鹅黄油", "天空青", "云水蓝", "薄荷绿", "玉白", "浅金", "白金", "暖银"],
    materials: ["绣花网纱", "珠光丝绸", "流云薄纱", "幻彩珍珠", "和田玉", "鎏金金属"],
    expressions: ["远望云海", "柔笑", "令下", "闭目感知"],
    dynamics: ["袖若云翼", "轻步踏云", "法器举起", "转身展裾"],
    accessories: ["头冠", "耳饰", "项链", "玉佩", "胸饰", "背饰", "流苏挂饰", "腰封", "戒指", "法器"],
    atmosphereZh: "云上仙殿破云天光，澄澈珠玉",
    promptFormulaKind: "standard",
  }),
];

const BY_ID = new Map(MANHUA_ANCIENT_ARCHETYPE_LIBRARY.map((b) => [b.id, b]));

export function getAncientArchetypeById(id?: string | null): ManhuaAncientDesignBoard | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return BY_ID.get(key) || null;
}

export function listAncientArchetypes(opts?: {
  lane?: ManhuaAncientDesignBoard["lane"] | null;
  query?: string;
}): ManhuaAncientDesignBoard[] {
  const lane = opts?.lane || null;
  const q = String(opts?.query || "")
    .trim()
    .toLowerCase();
  return MANHUA_ANCIENT_ARCHETYPE_LIBRARY.filter((b) => {
    if (lane && b.lane !== lane) return false;
    if (!q) return true;
    const hay = [b.nameZh, b.id, ...b.positioning, ...b.coreTags, b.promptZh]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function isAncientArchetypeId(id?: string | null): boolean {
  return Boolean(getAncientArchetypeById(id));
}

/** 注入角色卡 / 圣经：古风设计板 brief */
export function buildAncientArchetypePromptBlock(ids: string[]): string {
  const picked = ids
    .map((id) => getAncientArchetypeById(id))
    .filter(Boolean) as ManhuaAncientDesignBoard[];
  if (!picked.length) return "";
  return [
    "【古风原型锚点】",
    "与都市角色库并行；锁气质与服饰层次，贯穿全片；禁止外仓品牌名。",
    ...picked.map((b, i) => `${i + 1}. ${formatAncientDesignBoardBrief(b)}`),
  ].join("\n\n");
}
