/**
 * 自动关键词（规则版，纯函数）：中文镜头/段落描述 → 英文图库搜索词（2–6 个词）+ 中文展示词。
 *
 * 只从内置视觉词表取词，所以人名、对白、口号、抽象概念天然不会进搜索词；
 * 服务端优先走 LLM（server/services/stockFootage/keywords.ts），失败/未配置/格式不合格时退回这里。
 * 本文件也提供 LLM 输出的格式校验（normalizeStockKeywordQuery / normalizeStockKeywordQueryZh）。
 */
import { z } from "zod";
import {
  STOCK_FOOTAGE_ORIENTATIONS,
  STOCK_FOOTAGE_PURPOSES,
  type StockFootagePurpose,
} from "./stockFootage";

export const STOCK_KEYWORD_MIN_WORDS = 2;
export const STOCK_KEYWORD_MAX_WORDS = 6;
export const STOCK_KEYWORD_MAX_CHARS = 60;
export const STOCK_KEYWORD_ZH_MAX_CHARS = 20;
export const STOCK_KEYWORD_TEXT_MAX_CHARS = 1000;

export const stockFootageSuggestKeywordsInputSchema = z
  .object({
    text: z.string().trim().min(1).max(STOCK_KEYWORD_TEXT_MAX_CHARS),
    purpose: z.enum(STOCK_FOOTAGE_PURPOSES),
    orientation: z.enum(STOCK_FOOTAGE_ORIENTATIONS).optional(),
  })
  .strict();
export type StockFootageSuggestKeywordsInput = z.input<typeof stockFootageSuggestKeywordsInputSchema>;

export type StockKeywordSource = "llm" | "rules";
export type StockKeywordSuggestion = { query: string; queryZh: string; source: StockKeywordSource };

type Category = "scene" | "person" | "object" | "action" | "time" | "weather" | "mood" | "shot" | "block";

/** [类别, 英文, 中文展示, 匹配词（| 分隔）]。英文为空 = 拦截词：只占位防止短词误命中，不产出。 */
type VocabRow = readonly [Category, string, string, string];

const VOCAB: readonly VocabRow[] = [
  // ── 拦截词（非画面概念或易误命中的组合）──
  ["block", "", "", "风格|风险|风口|作风|马上|笑话|包括|包含|花钱|花费|花时间|山寨|走红|走势|云端|云计算|云服务|大家|专家|国家|书记|证书|说明书|镜头|画面|素材|视频|分镜|字幕|旁白|配音|台词|对白"],
  // ── 场景/地点 ──
  ["scene", "city night", "城市夜景", "城市夜景|都市夜景|城市的夜"],
  ["scene", "skyline", "天际线", "天际线|城市天际"],
  ["scene", "skyscrapers", "高楼", "高楼|摩天大楼|写字楼群"],
  ["scene", "city", "城市", "城市|都市|市区|市中心"],
  ["scene", "street", "街道", "街道|街头|马路|街景|街上|大街|街頭"],
  ["scene", "alley", "小巷", "小巷|胡同|巷子|巷口"],
  ["scene", "beach", "海边", "海边|海滩|沙滩|海岸|海邊"],
  ["scene", "ocean waves", "海浪", "海浪|浪花"],
  ["scene", "ocean", "大海", "大海|海洋|海面|海上"],
  ["scene", "lake", "湖", "湖边|湖面|湖泊|湖"],
  ["scene", "river", "河", "河边|江边|河流|小河|河"],
  ["scene", "waterfall", "瀑布", "瀑布"],
  ["scene", "bamboo forest", "竹林", "竹林"],
  ["scene", "forest", "森林", "森林|树林|林间|丛林|林中"],
  ["scene", "snow mountain", "雪山", "雪山"],
  ["scene", "mountain", "山", "山峰|群山|高山|山顶|山间|山谷|山脉|山"],
  ["scene", "starry sky", "星空", "星空|银河|星星|繁星"],
  ["scene", "sky", "天空", "天空|蓝天|苍穹"],
  ["scene", "clouds", "云", "云朵|云层|云海|白云|云"],
  ["scene", "meadow", "草地", "草原|草地|草坪"],
  ["scene", "desert", "沙漠", "沙漠"],
  ["scene", "fields", "田野", "田野|麦田|稻田|农田"],
  ["scene", "flower field", "花海", "花海|花田|花丛"],
  ["scene", "countryside", "乡村", "乡村|农村|乡间|田园"],
  ["scene", "landscape", "风景", "风景|山水|景色"],
  ["scene", "ancient chinese", "古风", "古风|古代|古装|古風"],
  ["scene", "palace", "宫殿", "宫殿|皇宫|宫廷|宫墙|宫門|宮殿|宫门"],
  ["scene", "chinese garden", "园林", "园林|亭台楼阁|亭子"],
  ["scene", "courtyard", "庭院", "庭院|院子|院落|四合院"],
  ["scene", "temple", "寺庙", "寺庙|寺院|古寺"],
  ["scene", "ancient town", "古镇", "古镇|古城"],
  ["scene", "great wall", "长城", "长城"],
  ["scene", "coffee shop", "咖啡店", "咖啡店|咖啡馆|咖啡厅|咖啡館|咖啡廳"],
  ["scene", "teahouse", "茶馆", "茶馆|茶室|茶楼"],
  ["scene", "office", "办公室", "办公室|写字楼|工位|辦公室|办公区"],
  ["scene", "meeting room", "会议室", "会议室"],
  ["scene", "kitchen", "厨房", "厨房|廚房"],
  ["scene", "restaurant", "餐厅", "餐厅|饭店|餐馆|餐廳"],
  ["scene", "hotel", "酒店", "酒店|宾馆"],
  ["scene", "bar", "酒吧", "酒吧"],
  ["scene", "nightclub", "夜店", "夜店|蹦迪"],
  ["scene", "bedroom", "卧室", "卧室|房间"],
  ["scene", "living room", "客厅", "客厅|沙发"],
  ["scene", "home", "家", "家里|居家|在家|家中"],
  ["scene", "classroom", "教室", "教室|课堂"],
  ["scene", "campus", "校园", "校园|学校|大学"],
  ["scene", "library", "图书馆", "图书馆|书店"],
  ["scene", "gym", "健身房", "健身房"],
  ["scene", "shopping mall", "商场", "商场|购物中心"],
  ["scene", "supermarket", "超市", "超市|便利店"],
  ["scene", "subway", "地铁", "地铁站|地铁"],
  ["scene", "train station", "车站", "火车站|车站|站台"],
  ["scene", "airport", "机场", "机场"],
  ["scene", "highway", "公路", "公路|高速公路|高速"],
  ["scene", "bridge", "桥", "大桥|桥"],
  ["scene", "rooftop", "天台", "天台|屋顶|楼顶"],
  ["scene", "park", "公园", "公园"],
  ["scene", "hospital", "医院", "医院|病房"],
  ["scene", "laboratory", "实验室", "实验室"],
  ["scene", "factory", "工厂", "工厂|车间|生产线"],
  ["scene", "stage", "舞台", "舞台"],
  ["scene", "concert", "演唱会", "演唱会|音乐节|现场演出"],
  ["scene", "window", "窗边", "窗边|窗前|窗外|窗户|窗"],
  // ── 时间 ──
  ["time", "golden hour", "黄金时刻", "黄金时刻|黄金时段"],
  ["time", "sunset", "日落", "日落|夕阳|黄昏|傍晚|落日|晚霞"],
  ["time", "sunrise", "日出", "日出|朝阳|黎明|破晓"],
  ["time", "morning", "清晨", "清晨|早晨|早上|晨光"],
  ["time", "night", "夜晚", "夜晚|夜里|深夜|晚上|夜色|午夜|夜景|夜"],
  ["time", "sunlight", "阳光", "阳光|白天|午后|日光"],
  ["time", "summer", "夏天", "夏天|夏日|盛夏"],
  ["time", "autumn", "秋天", "秋天|秋日|落叶"],
  ["time", "winter", "冬天", "冬天|冬日|寒冬"],
  ["time", "spring", "春天", "春天|春日"],
  // ── 天气 ──
  ["weather", "rainy night", "雨夜", "雨夜"],
  ["weather", "rain", "雨天", "下雨|雨天|雨中|雨水|大雨|雨滴|雨"],
  ["weather", "snow", "下雪", "下雪|雪景|雪地|大雪|雪花|雪"],
  ["weather", "smog", "雾霾", "雾霾"],
  ["weather", "fog", "雾", "大雾|薄雾|雾气|晨雾|雾"],
  ["weather", "lightning", "闪电", "闪电|雷雨|雷电"],
  ["weather", "storm", "暴风雨", "暴风雨|风暴|台风"],
  ["weather", "dark clouds", "乌云", "乌云|阴天"],
  ["weather", "sunny", "晴天", "晴天|晴朗"],
  ["weather", "wind", "风", "大风|微风|风吹|风"],
  // ── 人物 ──
  ["person", "crowd", "人群", "人群|人流|人潮|路人|行人"],
  ["person", "couple", "情侣", "情侣|恋人|夫妻"],
  ["person", "family", "一家人", "家庭|一家人|全家|家人"],
  ["person", "children", "孩子", "孩子|小孩|儿童|小朋友"],
  ["person", "elderly", "老人", "老人|老奶奶|老爷爷"],
  ["person", "girl", "女孩", "女孩|少女|女生|姑娘"],
  ["person", "woman", "女人", "女人|女性|女子|妈妈|母亲"],
  ["person", "boy", "男孩", "男孩|少年|男生"],
  ["person", "man", "男人", "男人|男性|男子|爸爸|父亲"],
  ["person", "friends", "朋友", "朋友|闺蜜|好友"],
  ["person", "team", "团队", "团队|同事|员工"],
  ["person", "businessman", "商务人士", "商务人士|白领|老板|职场人"],
  ["person", "student", "学生", "学生"],
  ["person", "singer", "歌手", "歌手"],
  ["person", "dancer", "舞者", "舞者"],
  ["person", "chef", "厨师", "厨师"],
  ["person", "doctor", "医生", "医生|护士"],
  ["person", "swordsman", "侠客", "侠客|剑客|武侠"],
  // ── 动作 ──
  ["action", "drinking coffee", "喝咖啡", "喝咖啡"],
  ["action", "walking", "行走", "行走|散步|漫步|走路|走在|走过|走"],
  ["action", "running", "奔跑", "奔跑|跑步|跑"],
  ["action", "dancing", "跳舞", "跳舞|舞蹈|起舞"],
  ["action", "singing", "唱歌", "唱歌|演唱|歌唱"],
  ["action", "cooking", "做饭", "做饭|烹饪|炒菜|下厨"],
  ["action", "typing", "打字", "打字|敲键盘"],
  ["action", "working", "工作", "工作|办公|加班"],
  ["action", "meeting", "开会", "开会|会议|讨论"],
  ["action", "hugging", "拥抱", "拥抱|相拥"],
  ["action", "smiling", "微笑", "微笑|笑容|大笑|笑"],
  ["action", "crying", "哭泣", "哭泣|流泪|哭"],
  ["action", "reading", "阅读", "看书|阅读|读书"],
  ["action", "driving", "开车", "开车|驾驶|驾车"],
  ["action", "cycling", "骑行", "骑车|骑行|骑自行车"],
  ["action", "swimming", "游泳", "游泳"],
  ["action", "surfing", "冲浪", "冲浪"],
  ["action", "taking photos", "拍照", "拍照|自拍"],
  ["action", "shopping", "购物", "购物|逛街"],
  ["action", "talking", "交谈", "聊天|交谈|对话"],
  ["action", "eating", "吃饭", "吃饭|用餐|吃东西"],
  ["action", "handshake", "握手", "握手"],
  ["action", "playing guitar", "弹吉他", "弹吉他"],
  ["action", "playing piano", "弹钢琴", "弹钢琴"],
  ["action", "looking back", "回眸", "回头|回眸"],
  ["action", "sword fighting", "舞剑", "舞剑|练剑|比剑|过招"],
  // ── 物体 ──
  ["object", "product", "产品", "产品|商品|新品"],
  ["object", "packaging", "包装", "包装|礼盒"],
  ["object", "skincare", "护肤品", "护肤品|面霜|精华"],
  ["object", "cosmetics", "化妆品", "化妆品|彩妆|化妆"],
  ["object", "lipstick", "口红", "口红"],
  ["object", "perfume", "香水", "香水"],
  ["object", "watch", "手表", "手表|腕表"],
  ["object", "handbag", "包", "包包|手提包|背包"],
  ["object", "sneakers", "运动鞋", "运动鞋|球鞋|鞋子|鞋"],
  ["object", "clothing", "服装", "衣服|服装|穿搭"],
  ["object", "jewelry", "首饰", "首饰|珠宝|项链|戒指"],
  ["object", "gift", "礼物", "礼物"],
  ["object", "money", "钱", "现金|钞票|金钱"],
  ["object", "coffee", "咖啡", "咖啡"],
  ["object", "tea", "茶", "茶杯|茶具|茶叶|茶"],
  ["object", "wine", "红酒", "红酒|葡萄酒|酒杯|酒"],
  ["object", "food", "美食", "美食|食物|菜品|料理"],
  ["object", "bread", "面包", "面包"],
  ["object", "cake", "蛋糕", "蛋糕|甜点"],
  ["object", "fruit", "水果", "水果"],
  ["object", "smartphone", "手机", "手机|智能手机"],
  ["object", "laptop", "笔记本电脑", "笔记本电脑|电脑|笔记本"],
  ["object", "keyboard", "键盘", "键盘"],
  ["object", "screen", "屏幕", "屏幕|显示器"],
  ["object", "book", "书", "书本|书籍|书"],
  ["object", "car", "汽车", "汽车|轿车|跑车|车"],
  ["object", "bicycle", "自行车", "自行车|单车"],
  ["object", "umbrella", "雨伞", "雨伞|撑伞|伞"],
  ["object", "neon lights", "霓虹灯", "霓虹灯|霓虹"],
  ["object", "lantern", "灯笼", "灯笼|花灯"],
  ["object", "candle", "蜡烛", "蜡烛|烛光"],
  ["object", "lights", "灯光", "灯光|路灯|灯火|灯"],
  ["object", "guitar", "吉他", "吉他"],
  ["object", "piano", "钢琴", "钢琴"],
  ["object", "microphone", "麦克风", "麦克风|话筒"],
  ["object", "sword", "剑", "长剑|宝剑|剑"],
  ["object", "horse", "马", "骏马|马匹|骑马|马"],
  ["object", "cat", "猫", "小猫|猫咪|猫"],
  ["object", "dog", "狗", "小狗|狗狗|狗"],
  ["object", "birds", "鸟", "飞鸟|鸟群|鸟"],
  ["object", "flowers", "花", "鲜花|花朵|花束|花"],
  ["object", "tree", "树", "大树|树木|树叶|树"],
  // ── 情绪/氛围 ──
  ["mood", "romantic", "浪漫", "浪漫"],
  ["mood", "cozy", "温馨", "温馨|温暖|惬意"],
  ["mood", "lonely", "孤独", "孤独|寂寞|孤单|独自"],
  ["mood", "sad", "伤感", "悲伤|难过|伤感|忧伤"],
  ["mood", "happy", "快乐", "快乐|开心|欢乐|喜悦"],
  ["mood", "calm", "宁静", "宁静|安静|平静|静谧"],
  ["mood", "busy", "繁华", "热闹|繁华|忙碌"],
  ["mood", "dreamy", "梦幻", "梦幻|唯美"],
  ["mood", "futuristic", "科技感", "科技感|未来感|赛博朋克|科幻"],
  ["mood", "technology", "科技", "科技|数码|人工智能"],
  ["mood", "vintage", "复古", "复古|怀旧|老式"],
  ["mood", "epic", "壮观", "壮观|震撼|史诗|宏大"],
  ["mood", "mysterious", "神秘", "神秘|悬疑"],
  ["mood", "luxury", "高级感", "奢华|高级感|高端|豪华"],
  ["mood", "minimal", "极简", "简约|极简"],
  // ── 景别/拍法 ──
  ["shot", "close up", "特写", "大特写|特写|近景"],
  ["shot", "aerial", "航拍", "航拍|俯拍|鸟瞰|俯瞰"],
  ["shot", "slow motion", "慢动作", "慢动作|慢镜头|升格"],
  ["shot", "timelapse", "延时", "延时摄影|延时|缩时"],
  ["shot", "wide shot", "全景", "大远景|全景|远景"],
  ["shot", "tracking shot", "跟拍", "跟拍|跟随"],
  ["shot", "silhouette", "剪影", "剪影|逆光"],
  ["shot", "bokeh", "虚化", "背景虚化|虚化|散景"],
  ["shot", "pov", "第一人称", "第一人称|主观视角"],
];

type VocabEntry = { cat: Category; en: string; zh: string; order: number };
type PatternEntry = { pattern: string; entry: VocabEntry };

const ENTRIES: VocabEntry[] = VOCAB.map(([cat, en, zh], order) => ({ cat, en, zh, order }));
/** 最长匹配优先：长词先占位，短词不再重叠命中（「城市夜景」不会再被拆成「城市」+「夜」）。 */
const PATTERNS: PatternEntry[] = VOCAB.flatMap(([, , , patterns], i) =>
  patterns.split("|").filter(Boolean).map(pattern => ({ pattern, entry: ENTRIES[i] }))
).sort((a, b) => b.pattern.length - a.pattern.length || a.entry.order - b.entry.order);

/** 英文直输时只认词表里的整条英文（不认人名/品牌等任意英文）。 */
const EN_ENTRY_BY_WORD = new Map<string, VocabEntry>(
  ENTRIES.filter(e => e.en && !e.en.includes(" ")).map(e => [e.en, e] as const)
);

/** 选词优先级（满 6 词时先保留谁）。 */
const PICK_ORDER: Category[] = ["scene", "person", "object", "time", "weather", "action", "shot", "mood"];
/** 输出顺序（图库搜索更像「谁 做什么 什么东西 在哪 何时 天气 氛围 拍法」）。 */
const OUTPUT_ORDER: Category[] = ["mood", "person", "action", "object", "scene", "time", "weather", "shot"];

const PURPOSE_DEFAULTS: Record<StockFootagePurpose, { query: string; queryZh: string; filler: string }> = {
  mv: { query: "cinematic landscape", queryZh: "电影感风景", filler: "cinematic" },
  marketing: { query: "lifestyle people", queryZh: "生活场景", filler: "lifestyle" },
  digital_human: { query: "modern office background", queryZh: "现代办公背景", filler: "background" },
  manhua: { query: "ancient chinese landscape", queryZh: "古风山水", filler: "cinematic" },
};

/** 「某某：“……”」里，这些前缀后的引号内容是画面/旁白本身，保留；其余视为角色台词丢弃。 */
const CONTENT_PREFIXES = new Set(["画面", "镜头", "场景", "景别", "描述", "内容", "背景", "环境", "时间", "地点", "动作", "旁白", "画外音", "解说", "口播", "文案", "字幕"]);

/** 去掉对白、说话人前缀等非画面内容（人名常出现在这些位置）。 */
export function stripNonVisualText(text: string): string {
  const speaker = "(^|[\\n\\r。！？；!?;])\\s*([\\u4e00-\\u9fa5A-Za-z·]{1,5})\\s*(?:[（(][^）)]{0,12}[）)])?\\s*[：:]";
  return String(text || "")
    // 「某某：“台词”」——只丢引号里的台词，引号后的动作描写保留
    .replace(new RegExp(`${speaker}\\s*[“"「『]([^”"」』]*)[”"」』]`, "g"), (_all, lead: string, who: string, quoted: string) =>
      `${lead} ${CONTENT_PREFIXES.has(who) ? quoted : ""} `)
    .replace(/[“"「『][^”"」』]*[”"」』]/g, " ")
    // 不带引号的「某某：」只去掉前缀本身（可能是人名，也可能是「卖点：」这类标签），内容保留
    .replace(new RegExp(speaker, "g"), (_all, lead: string) => `${lead} `)
    .replace(/@\S+/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
}

type Match = { entry: VocabEntry; pos: number };

function matchVocabulary(text: string): Match[] {
  const used = new Uint8Array(text.length);
  const found = new Map<VocabEntry, number>();
  for (const { pattern, entry } of PATTERNS) {
    let from = 0;
    while (from <= text.length - pattern.length) {
      const at = text.indexOf(pattern, from);
      if (at < 0) break;
      let free = true;
      for (let i = at; i < at + pattern.length; i++) if (used[i]) { free = false; break; }
      if (free) {
        for (let i = at; i < at + pattern.length; i++) used[i] = 1;
        const prev = found.get(entry);
        if (prev === undefined || at < prev) found.set(entry, at);
      }
      from = at + 1;
    }
  }
  // 英文直输：只认词表里的单词
  const latin = /[A-Za-z]+/g;
  let m: RegExpExecArray | null;
  while ((m = latin.exec(text))) {
    const entry = EN_ENTRY_BY_WORD.get(m[0].toLowerCase());
    if (entry && !found.has(entry)) found.set(entry, m.index);
  }
  return Array.from(found, ([entry, pos]) => ({ entry, pos })).filter(x => x.entry.cat !== "block" && x.entry.en);
}

/**
 * 规则版：返回英文 2–6 词 + 中文展示。永不抛错；词表一个都没命中时给用途默认词。
 */
export function suggestStockKeywordsByRules(
  text: string,
  purpose: StockFootagePurpose
): { query: string; queryZh: string } {
  const defaults = PURPOSE_DEFAULTS[purpose] ?? PURPOSE_DEFAULTS.mv;
  const matches = matchVocabulary(stripNonVisualText(text));
  if (!matches.length) return { query: defaults.query, queryZh: defaults.queryZh };

  const byPick = [...matches].sort(
    (a, b) => PICK_ORDER.indexOf(a.entry.cat) - PICK_ORDER.indexOf(b.entry.cat) || a.pos - b.pos
  );
  const seen = new Set<string>();
  const picked: { match: Match; words: string[] }[] = [];
  let count = 0;
  for (const match of byPick) {
    const words = match.entry.en.split(" ").filter(w => !seen.has(w));
    if (!words.length) continue;
    if (count + words.length > STOCK_KEYWORD_MAX_WORDS) continue;
    words.forEach(w => seen.add(w));
    picked.push({ match, words });
    count += words.length;
  }
  picked.sort(
    (a, b) => OUTPUT_ORDER.indexOf(a.match.entry.cat) - OUTPUT_ORDER.indexOf(b.match.entry.cat) || a.match.pos - b.match.pos
  );
  let words = picked.flatMap(p => p.words);
  if (words.length < STOCK_KEYWORD_MIN_WORDS) words = [defaults.filler, ...words];
  const zh = Array.from(new Set(picked.map(p => p.match.entry.zh))).join(" ");
  return {
    query: words.join(" "),
    queryZh: zh.length > STOCK_KEYWORD_ZH_MAX_CHARS ? zh.slice(0, STOCK_KEYWORD_ZH_MAX_CHARS).trim() : zh,
  };
}

/** 搜索词里没有检索价值的填充词（LLM 常顺手带上）。 */
const FILLER_WORDS = new Set(["a", "an", "the", "stock", "footage", "video", "videos", "clip", "clips", "photo", "photos", "image", "images", "hd", "4k", "free"]);

/**
 * 校验并规范化 LLM 给出的英文搜索词：只允许英文小写单词（含 ' -），去掉填充词后 2–6 词、≤60 字符。
 * 不合格返回 null（调用方退回规则版），绝不截断冒充合格。
 */
export function normalizeStockKeywordQuery(raw: unknown): string | null {
  const source = Array.isArray(raw) ? raw.join(" ") : raw;
  if (typeof source !== "string") return null;
  const tokens = source.toLowerCase().replace(/[,，;；、/|]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const words = tokens.filter(t => !FILLER_WORDS.has(t));
  if (words.some(t => !/^[a-z][a-z'-]*$/.test(t))) return null;
  if (words.length < STOCK_KEYWORD_MIN_WORDS || words.length > STOCK_KEYWORD_MAX_WORDS) return null;
  const query = words.join(" ");
  return query.length <= STOCK_KEYWORD_MAX_CHARS ? query : null;
}

/** 校验 LLM 给出的中文展示词：必须含汉字、不含拉丁字母（防供应商/英文漏到前台）、≤20 字。 */
export function normalizeStockKeywordQueryZh(raw: unknown): string | null {
  const source = Array.isArray(raw) ? raw.join(" ") : raw;
  if (typeof source !== "string") return null;
  const zh = source.replace(/[，,、;；/|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!zh || !/[一-龥]/.test(zh) || /[A-Za-z]/.test(zh)) return null;
  return zh.length <= STOCK_KEYWORD_ZH_MAX_CHARS ? zh : null;
}
