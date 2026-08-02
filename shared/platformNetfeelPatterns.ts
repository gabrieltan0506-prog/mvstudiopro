/**
 * 全案选题「网感」正向句式 + 封面壳 + A1 抽帧配色池。
 * 样本课：~/Downloads/2026Aug01/A1-netfeel-highlights.md（163 帧）+ 趋势长图左下/右下。
 * 学结构/钩子/配色气质，不抄竞品 UI/商标。
 * trend：小红书主、B站/抖音辅；医疗向仍可叠审核友好。
 */

/** 全案读 trend 时的平台权重（注入 Stage2 user JSON + system） */
export const PLATFORM_TREND_PRIORITY_FOR_FULLCASE = {
  primary: ["xiaohongshu"] as const,
  secondary: ["bilibili", "douyin"] as const,
  note:
    "选题钩子与封面气质优先对齐小红书近窗 highEngagementSamples；B站与抖音同批参考节奏/反差，禁止抄原标题；快手/视频号可作补充，不抢主结构。",
} as const;

/**
 * A1 抽帧强调色池（同批轮换，禁止六条同色）。
 * 用户举例（樱桃红/水蜜桃/玫瑰金/蓝）仅为池中成员，不是唯一合法色。
 */
export const PLATFORM_NETFEEL_ACCENT_PALETTE = [
  {
    id: "warm_yellow_block",
    labelZh: "暖黄提亮块",
    hint: "黄底黑/深字杀伤句（便利店粗标、中部浮条）",
  },
  {
    id: "hot_pink_flank",
    labelZh: "品红/玫粉侧栏",
    hint: "左右竖排夹人脸大字（强女心态气质）",
  },
  {
    id: "truth_crimson",
    labelZh: "真相深红/樱桃红",
    hint: "背后竖排「真相」类字；精致莓红，忌番茄荧光大红",
  },
  {
    id: "eye_green",
    labelZh: "吸睛绿",
    hint: "绿底/绿描边杀伤句（家装画中画气质）",
  },
  {
    id: "knowledge_black_gold",
    labelZh: "知识黑金",
    hint: "深底 + 金/白大数字（手里有80万气质）",
  },
  {
    id: "heartfelt_red",
    labelZh: "走心红",
    hint: "标签钩/情感向朱红描边，克制不俗艳",
  },
  {
    id: "peach",
    labelZh: "水蜜桃色",
    hint: "柔暖桃色提亮关键字或下划线",
  },
  {
    id: "rose_gold",
    labelZh: "玫瑰金",
    hint: "金属玫瑰金提亮，杂志高级感",
  },
  {
    id: "sky_cobalt",
    labelZh: "天蓝/钴蓝",
    hint: "提问壳或知识向蓝白对比",
  },
  {
    id: "champagne_amber",
    labelZh: "香槟金/暖琥珀",
    hint: "米白主字 + 金琥珀杀伤词",
  },
] as const;

export type PlatformNetfeelTitlePatternId =
  | "bracket_pipe_contrast"
  | "authority_oral_punch"
  | "metaphor_poison_desire"
  | "season_life_vibe"
  | "action_then_progress"
  | "self_deprecating_office"
  | "number_twist_result"
  | "open_loop_n_steps"
  | "value_nail_emotion_bar"
  | "hashtag_truth_hook";

export type PlatformNetfeelTitlePattern = {
  id: PlatformNetfeelTitlePatternId;
  labelZh: string;
  skeleton: string;
  vibeExamples: string[];
};

/** 生活烟火气 + 强反差 + 幽默吸睛（趋势长图 + A1 模板钩子） */
export const PLATFORM_NETFEEL_TITLE_PATTERNS: PlatformNetfeelTitlePattern[] = [
  {
    id: "bracket_pipe_contrast",
    labelZh: "方括号钉词｜双拍反差",
    skeleton: "真不敢议[痛点场景]谨记[可执行习惯]｜[蓝海/时效钉子]",
    vibeExamples: [
      "真不敢议[职场人胖]谨记[减脂习惯]｜蓝海只这一个月急救",
      "别再装懂[加班续命]｜先把[睡眠账]算清楚",
    ],
  },
  {
    id: "authority_oral_punch",
    labelZh: "权威口吻×口语爽感",
    skeleton: "[身份/方法名]不一次真省事｜[可信身份]教[一个组合]解决顽疾",
    vibeExamples: [
      "[毛病分析法]不一次真省事｜医学博士教[一个组合]解决顽疾",
      "别死磕意志力｜把[复盘三问]当成随身工具",
    ],
  },
  {
    id: "metaphor_poison_desire",
    labelZh: "强反差隐喻",
    skeleton: "名为[看似正确的东西]的蛊毒，明明是你[真实欲望/失控点]",
    vibeExamples: [
      "名为[健康食谱]的蛊毒，明明是你吃不过量的渴望",
      "名叫[自律打卡]的牢笼，其实是你不敢停下来的慌",
    ],
  },
  {
    id: "season_life_vibe",
    labelZh: "季节烟火气",
    skeleton: "[季节/日常动作钉子]｜不敢相信的[人群]，[元气结果]就是自我",
    vibeExamples: [
      "一个夏天就要多喝｜不敢相信的职场人，元气满满就是自我",
      "便利店关灯前那十分钟｜打工人的夜宵哲学突然说通了",
    ],
  },
  {
    id: "action_then_progress",
    labelZh: "先定习惯再开进度",
    skeleton: "定期开启[自愈/复盘]不设防｜先定[习惯钉]再开启自己进度",
    vibeExamples: [
      "定期开启自愈力不设防｜先定[减脂习惯]再开启自己进度",
      "别急着报课｜先锁[早起二十分钟]再谈逆袭",
    ],
  },
  {
    id: "self_deprecating_office",
    labelZh: "职场自嘲幽默",
    skeleton: "[尴尬生活局]｜[人群]终于承认[反常识一句]",
    vibeExamples: [
      "工位第三杯美式下肚｜我才承认不是咖啡不够，是边界没有",
      "又被「你看起来很精神」吓到｜高压人的假元气识别指南",
    ],
  },
  {
    id: "number_twist_result",
    labelZh: "数字拧巴结果颠倒",
    skeleton: "[夸张数字/动作]，反而[意外结果]｜[人群]别再[常识误区]",
    vibeExamples: [
      "我每天吃了十碗饭，反而瘦了十斤",
      "他天天打游戏，放榜怎么考上了北大？",
    ],
  },
  {
    id: "open_loop_n_steps",
    labelZh: "开放好奇·先做N件事",
    skeleton: "[欲望目标]，[反常识别做]｜先做[N]件事",
    vibeExamples: [
      "想吃瘦｜别减主食做三事",
      "想睡饱｜别硬扛先做两事",
    ],
  },
  {
    id: "value_nail_emotion_bar",
    labelZh: "价值钉+情绪底条",
    skeleton: "[价值结果钉]｜[情绪条：又挖到宝了/刷到就是赚到]",
    vibeExamples: [
      "99元穿出大牌质感｜又挖到宝了",
      "普通人如何选房子｜刷到就是赚到",
    ],
  },
  {
    id: "hashtag_truth_hook",
    labelZh: "标签真相钩",
    skeleton: "#[年限/场景]真相｜[反常识一句]",
    vibeExamples: [
      "#15年婚姻真相｜不是改造而是托住",
      "#职场午餐真相｜别先砍主食",
    ],
  },
];

export type PlatformNetfeelCoverShellId =
  | "flank_keyword"
  | "steps_result"
  | "truth_vertical"
  | "big_topic_warn"
  | "question_fork"
  | "life_stall_vibe"
  | "beauty_pink_dual"
  | "simple_recolor"
  | "pip_eye_green"
  | "knowledge_black_gold"
  | "manga_bold_stall"
  | "growth_vertical_triad"
  | "howto_hand_english"
  | "neon_arrow_question"
  | "slash_wrap_product"
  | "food_taste_frame"
  | "count_haul_number"
  | "arrow_annotate_dual"
  | "warm_letgo_four"
  | "magazine_masthead";

export type PlatformNetfeelCoverShell = {
  id: PlatformNetfeelCoverShellId;
  labelZh: string;
  /** 建议强调色（从池里选，可替换） */
  preferredAccents: string[];
  visualHint: string;
};

/** A1 网感封面 + 模板壳（同批轮换） */
export const PLATFORM_NETFEEL_COVER_SHELLS: PlatformNetfeelCoverShell[] = [
  {
    id: "flank_keyword",
    labelZh: "左右竖排关键词夹人脸",
    preferredAccents: ["hot_pink_flank", "peach", "rose_gold"],
    visualHint:
      "人脸居中；左右/上下侧栏 2 字级粗描边大字；中部色块短钩；侧栏字可轻压肩背增张力（勿遮眼口）；表情有戏。",
  },
  {
    id: "steps_result",
    labelZh: "N步/N件事+好奇开放环",
    preferredAccents: ["warm_yellow_block", "champagne_amber", "sky_cobalt"],
    visualHint: "主句含 N步/先做N件事；数字提亮；吃喝向张口大吃或竖指；忌弱钩无下文。",
  },
  {
    id: "truth_vertical",
    labelZh: "背后巨大竖排真相字",
    preferredAccents: ["truth_crimson", "heartfelt_red", "rose_gold"],
    visualHint: "背后超大竖排「真相」类词（可轻微变形）；前景反常识副句。",
  },
  {
    id: "big_topic_warn",
    labelZh: "类目大字+因果钉子",
    preferredAccents: ["champagne_amber", "sky_cobalt", "peach"],
    visualHint:
      "顶栏类目大字（养生/职场等）+ 因果/反差杀伤句；可带弱一档的背景小字层做信息密度（透明度/字号明显低于主句）；忌病名恐吓墙。",
  },
  {
    id: "question_fork",
    labelZh: "机会/劫难二选一提问",
    preferredAccents: ["warm_yellow_block", "sky_cobalt", "peach"],
    visualHint: "黄白或蓝白提问大字占上半屏；普通人视角二选一。",
  },
  {
    id: "life_stall_vibe",
    labelZh: "便利店/市井烟火气",
    preferredAccents: ["warm_yellow_block", "eye_green", "peach"],
    visualHint: "便利店货架/家装/哄娃客厅证据画面；粗标+描边副句；禁空书房讲课脸。",
  },
  {
    id: "beauty_pink_dual",
    labelZh: "冻龄双行·粉系紧凑",
    preferredAccents: ["peach", "hot_pink_flank", "rose_gold"],
    visualHint:
      "上下两行紧排短句（各 ≤6 字），粉/桃系托底；人脸占中，双行贴脸但不压五官；忌三行以上。",
  },
  {
    id: "simple_recolor",
    labelZh: "简约可换色",
    preferredAccents: ["peach", "rose_gold", "sky_cobalt", "champagne_amber"],
    visualHint: "真人半身+顶栏价值钉大字+底部情绪条；配色可换，气质干净高级。",
  },
  {
    id: "pip_eye_green",
    labelZh: "吸睛绿·画中画感",
    preferredAccents: ["eye_green", "warm_yellow_block"],
    visualHint: "室内/家装 POV + 绿底杀伤句；可有小画中画证据，勿说明书墙。",
  },
  {
    id: "knowledge_black_gold",
    labelZh: "知识黑金大数字",
    preferredAccents: ["knowledge_black_gold", "champagne_amber"],
    visualHint: "深色底+金/白大数字拧巴；人像有戏；忌土豪金塑料感。",
  },
  {
    id: "manga_bold_stall",
    labelZh: "漫味粗标·烟火气",
    preferredAccents: ["warm_yellow_block", "heartfelt_red", "peach"],
    visualHint: "便利店/市井货架+黄底粗标+白描边副句；人物表情夸张同档。",
  },
  {
    id: "growth_vertical_triad",
    labelZh: "竖排三段词+底部结果条",
    preferredAccents: ["peach", "rose_gold", "champagne_amber"],
    visualHint:
      "右侧或左侧竖排三个短词分层排（如「女性/成长/手册」各 2–3 字）；底部一条窄色带写结果句（拒绝内耗）；人像半身托住，勿被字挤到边角。",
  },
  {
    id: "howto_hand_english",
    labelZh: "英文手写压中文错落大字",
    preferredAccents: ["truth_crimson", "warm_yellow_block", "sky_cobalt"],
    visualHint:
      "顶部一行英文手写体（How To 之类）压在中文主词上方；中文两词错落排、字距咬合但不堆叠；英文只作装饰层，读不读得懂都不影响主句。",
  },
  {
    id: "neon_arrow_question",
    labelZh: "暖色细笔刷箭头+问句钉",
    preferredAccents: ["peach", "rose_gold", "champagne_amber"],
    visualHint:
      "人像旁用**桃/玫瑰金/暖琥珀细笔刷箭头**（墨笔触感）轻点关键处；底部深色条压米白/暖黄问句；箭头只 1–2 处、细而克制。【硬禁】荧光绿/荧光黄荧光笔、贴纸堆、整块撞色侧栏（已剔除 neon_flank）。",
  },
  {
    id: "slash_wrap_product",
    labelZh: "斜杠夹字+手持实物",
    preferredAccents: ["peach", "rose_gold", "warm_yellow_block"],
    visualHint:
      "顶部 `\\短句/` 手写斜杠夹住 4–6 字；人物手持实物怼镜；底部一句行动钉（就看它/直接冲）；斜杠字号不超过主句。",
  },
  {
    id: "food_taste_frame",
    labelZh: "食物大图+白框手写感叹",
    preferredAccents: ["warm_yellow_block", "heartfelt_red", "peach"],
    visualHint:
      "近景食物占画面一半以上（热气/摆盘可见）；白底手写框写「还想再来N次!」类感叹；人物张口大吃或递碗，表情满足。",
  },
  {
    id: "count_haul_number",
    labelZh: "数字件数好物墙",
    preferredAccents: ["champagne_amber", "peach", "sky_cobalt"],
    visualHint:
      "主句含具体件数（100件/7台/12样），数字明显大一号；可配 `\\小贵但超值/` 类态度短句；人物拆箱/展示，惊喜表情。",
  },
  {
    id: "arrow_annotate_dual",
    labelZh: "左右大字夹人+箭头注解",
    preferredAccents: ["hot_pink_flank", "rose_gold", "truth_crimson"],
    visualHint:
      "左右两侧各一个 2 字大词夹住人脸；中间用细箭头引出一句做法注解（→ 一定要频繁）；注解字小两号，不与主词抢。",
  },
  {
    id: "warm_letgo_four",
    labelZh: "暖光四字+温柔副句",
    preferredAccents: ["champagne_amber", "rose_gold", "peach"],
    visualHint:
      "暖光室内人像（灯下/窗边），四字主词横排居中偏下，下面一行温柔副句（是最善良的放生）；情绪向选题用，表情自然放松。",
  },
  {
    id: "magazine_masthead",
    labelZh: "私人笔记刊头风",
    preferredAccents: ["rose_gold", "champagne_amber", "peach"],
    visualHint:
      "顶部一行**私人笔记感**英文小字（如 private notes · 2026），不作假杂志品牌名；暖窗光生活场景；主句衬线或细描边，奶油纸质留白；表情松弛可亲。【硬禁】Forbes/Fortune 式冷刊头、条码期号墙、商标感 logo。",
  },
];

export type PlatformNetfeelTypeDeviceId =
  | "slash_wrap"
  | "bilingual_subtitle"
  | "warm_arrow_annotate"
  | "hand_english_over_cn"
  | "picture_in_picture"
  | "dual_label_bar"
  | "private_notes_masthead";

/**
 * A1 重抽帧（4fps/326 帧）补记的排版手法：与「壳」正交，可叠在任一壳上轮换。
 * 划线否定 / 荧光箭头 / 假杂志刊头已从手法池剔除（见 REJECTED）。
 */
export const PLATFORM_NETFEEL_TYPE_DEVICES: {
  id: PlatformNetfeelTypeDeviceId;
  labelZh: string;
  hint: string;
}[] = [
  {
    id: "slash_wrap",
    labelZh: "斜杠夹字",
    hint: "用手写斜杠把 4–6 字态度短句夹起来（\\小贵但超值/）；一张封面只用一次。",
  },
  {
    id: "bilingual_subtitle",
    labelZh: "中英双语条",
    hint: "主句下方跟一行小号英文对照（7 台主流安卓 / 7 mainstream devices）；英文只作节奏装饰，勿承担信息。",
  },
  {
    id: "warm_arrow_annotate",
    labelZh: "暖色细笔刷箭头",
    hint: "桃/玫瑰金/暖琥珀细笔刷箭头圈注关键处；1–2 处即可。禁荧光绿荧光笔与贴纸堆（已剔除 neon_flank）。",
  },
  {
    id: "hand_english_over_cn",
    labelZh: "英文手写压中文",
    hint: "英文手写体压在中文主词上层做层次；中文可错落但**禁止**做成立体变形花字墙。",
  },
  {
    id: "picture_in_picture",
    labelZh: "画中画证据",
    hint: "人像口播为主体，角落嵌一小块实拍/截图作证据；画中画不超过画面 1/4。",
  },
  {
    id: "dual_label_bar",
    labelZh: "双层标签条",
    hint: "顶部叠两条窄标签：上条写类目（孩子学习），下条写结果或反差（主动权改变一切）。",
  },
  {
    id: "private_notes_masthead",
    labelZh: "私人笔记刊头小字",
    hint: "顶部 private notes · 年份 一类私人笔记小字；暖光生活场景；禁假杂志品牌名与条码期号墙。",
  },
];

/**
 * A1 抽帧里被人工审美否掉的壳（2026-08-01 用户过审）。
 * 保留 id 与理由，避免后续再被当「网感参考」捡回来。
 */
export const PLATFORM_NETFEEL_REJECTED_SHELLS: {
  id: string;
  labelZh: string;
  reasonZh: string;
}[] = [
  {
    id: "abstract_stunt",
    labelZh: "跳伞/高空飞人抽象冲击",
    reasonZh: "表情过度夸张、动作抽象僵硬，不像真人在做事。",
  },
  {
    id: "deform_tension",
    labelZh: "变形文字墙",
    reasonZh: "主词变形立体到吃掉画面，人物退成背景。",
  },
  {
    id: "answer_spoiler",
    labelZh: "答案剧透版",
    reasonZh: "把「三件事」逐条写在封面上，看完不必点进来。",
  },
  {
    id: "tiny_type",
    labelZh: "字号过小",
    reasonZh: "缩略图尺寸下主句读不出，丢掉停滑冲击。",
  },
  {
    id: "neon_flank",
    labelZh: "荧光撞色侧栏",
    reasonZh: "荧光粉绿贴纸感偏俗，拉低品相。",
  },
  {
    id: "strike_negation",
    labelZh: "划线否定句反转",
    reasonZh: "删除线缩略图难读，像作业批改，否定感压人（2026-08-02 过审踢）。",
  },
  {
    id: "gold_vertical_money",
    labelZh: "黑金竖排财富词",
    reasonZh: "黑金堆砌易土豪暴富感，难压住品相（2026-08-02 过审踢）。",
  },
  {
    id: "ratio_compare_beauty",
    labelZh: "比例/前后对比标注",
    reasonZh: "比例线/前后对比偏医美硬广，功利感过重（2026-08-02 过审踢）。",
  },
];

function composeRejectedShellGuidance(): string {
  const lines = PLATFORM_NETFEEL_REJECTED_SHELLS.map(
    (s) => `- ${s.labelZh}（${s.id}）：${s.reasonZh}`,
  ).join("\n");
  return `【已剔除·禁止复现的封面做法】
${lines}`;
}

function composeAccentPaletteGuidance(): string {
  const lines = PLATFORM_NETFEEL_ACCENT_PALETTE.map(
    (a) => `- ${a.id}（${a.labelZh}）：${a.hint}`,
  ).join("\n");
  return `【A1 抽帧强调色池·同批轮换·禁止写死单色】
每条封面从下列池中**选 1 个主强调色**（可再叠米白主字）；六条封面尽量用 ≥4 种不同 id。樱桃红/水蜜桃/玫瑰金/蓝/黄/粉/吸睛绿/黑金等均为合法举例，**按壳与选题气质选色，不要全批锁死一种红或一种金**。
${lines}
禁：俗艳番茄大红墙、荧光粉绿撞色贴纸堆、三色以上乱抢、价签感塑料字。`;
}

/** Stage2 / 初选 / 决策智库共用：网感标题引导 */
export function composePlatformNetfeelTitleGuidance(): string {
  const lines = PLATFORM_NETFEEL_TITLE_PATTERNS.map(
    (p, i) =>
      `${i + 1}. ${p.labelZh}（${p.id}）：骨架「${p.skeleton}」· 气质例：${p.vibeExamples[0]}`,
  );
  return `【网感标题·生活烟火气 + 强反差 + 幽默吸睛·硬门槛】
全案选题 title / hook / coverHeadline 须活泼生动，优先信息流口语，禁止干巴论文腔与「正确打开方式」无聊题。
句式库（改写到本人设，**禁止照抄例句**；同批尽量覆盖 ≥5 种不同 id——含趋势长图句式与 A1 价值钉/标签真相/好奇环）：
${lines.join("\n")}
结构偏好：\`[关键词]\` 钉词 + 全角 \`｜\` 双拍；情绪形容词 + 具体场景（便利店、工位咖啡、家装、哄娃、夏天多喝）。
好奇缺口：可用「先做N件事/N步/又挖到宝了/刷到就是赚到」等开放环，让人想点开；弱钩（只有禁令无下文）须升级。
配额：同批至少 **4/6** 条含烟火气/自嘲幽默/隐喻反差；coverHeadline 短、拧、可单独停滑。
表达：像朋友转述，不像培训讲师念稿。
反论文腔（硬）：禁止「浅析／探究／指南／全解析／方法论／正确打开方式／注意事项／深度解读」这类腔调与名词堆砌式学术标题。
自检一句：这条出现在信息流里，用户会停下来还是直接划走？会划走就重写。`;
}

/**
 * 夸张文案 ↔ 夸张表情/动作同拍 + A1 全量配色池。
 */
export function composePlatformNetfeelExpressionMatchGuidance(): string {
  return `【网感封面·表情按选题定档·不是每张都夸张】
先判选题气质，再决定表情强度——**夸张只是其中一档，不是默认值**：
- **平静生活向**（日常记录、居家、慢节奏、温和分享）→ 自然生活神态即可：认真做事、低头笑、专注、放松；**不要**硬掰成瞪眼张嘴。
- **共鸣吐槽向**（小尴尬、明知不对还是做、朋友会转发的那种）→ 会心一笑、无奈摊手、心虚偷瞄，**中等强度**。
- **反差/反常识/猎奇向**（数字拧巴、结果颠倒、身份错位）→ 才用错愕张嘴、瞪大眼、坏笑等**较强表情**。
共同底线：文字很拧时人不能发呆望窗外或证件照微笑；反过来，选题本身平和时也不要上满脸用力的表演。
同拍配对（按上面档位择一，勿说明书堆叠）：
- 吃喝/减脂 → **张口大吃、鼓腮、叉子怼嘴、满足/惊喜**；「N件事」可竖指
- 反常识/真相壳 → 瞪大眼、错愕张嘴、坏笑、探身递证据
- 步骤/数字 → 比数、点桌、怼屏幕证据 + 笃定/得意
- 抽象冲击 → 失衡/跳跃/夸张递物，情绪可读
- 简约/情绪条 → 递物怼镜或坏笑「挖到宝」感
**禁止**：冷脸大片、望景发呆、正襟危坐与夸张标题同框；也禁另一头的「每块面部肌肉都在用力」的过度夸张。
${composeAccentPaletteGuidance()}
主字偏米白/象牙白；杀伤词用本条选定强调色（黄底块/侧栏粉/竖排红/吸睛绿/黑金/桃/玫瑰金/蓝/香槟金等）；可细笔刷下划线。字重可厚，但**禁止把主词做成立体变形花字**。`;
}

function composeTypeDeviceGuidance(): string {
  const lines = PLATFORM_NETFEEL_TYPE_DEVICES.map(
    (d) => `- ${d.id}（${d.labelZh}）：${d.hint}`,
  ).join("\n");
  return `【排版手法·可叠在任一壳上·同批轮换】
每张封面挑 **1–2 个**（不是全用），用来把两行字做出层次：
${lines}
叠加上限：主句仍须 ≤13 字且一眼读完；手法不得盖过人物与主句。`;
}

/** 封面出图：A1 全壳 + 排版手法 + 表情同拍 + 配色池 */
export function composePlatformNetfeelCoverGuidance(): string {
  const shells = PLATFORM_NETFEEL_COVER_SHELLS.map(
    (s) =>
      `- ${s.id}（${s.labelZh}｜建议色 ${s.preferredAccents.join("/")}）：${s.visualHint}`,
  ).join("\n");
  return `【网感封面壳·A1 抽帧全量对齐】
竖版信息流封面须从下列壳中**选一主壳**（同批六条轮换，禁止六条同壳；模板行与封面行都要用上）：
${shells}
版式：侧栏大字 / 背后竖排 / 黄底粗标 / 绿杀伤句 / 黑金大数字 / 粉系双行均可；主信息服务 coverHeadline；禁百科多图标墙与 CTA 墙。
画面：真人**正在做事** + 烟火气场域（便利店/家装/哄娃/餐厅）；禁培训坐姿脸，也禁飞人跳伞类抽象摆拍。
${composeTypeDeviceGuidance()}
${composeRejectedShellGuidance()}
${composePlatformNetfeelExpressionMatchGuidance()}
屏内字：中国大陆简体；杀伤字 2–6 个提亮。`;
}

/** trendStore 平台优先级说明 */
export function composePlatformTrendPriorityGuidance(): string {
  return `【trendStore 平台权重·全案】
**动笔前必须先看**：主参考 **小红书（xiaohongshu）** 近窗 highEngagementSamples / recentTitles / tagCandidates；辅参考 **B站（bilibili）** 与 **抖音（douyin）**（借节奏、反差与口语钩子）；快手 / 视频号可补充，不决定主结构。
读完的用法：先从热门里挑出**正在被讨论的生活话题与情绪**，再改写成本人设讲得了的选题——方向取生活化、趣味化、幽默风趣、容易引起共鸣。
一律**禁止字面抄袭**样本标题；**改不动的不硬套**（与本人设八竿子打不着就放弃这条，别嫁接成四不像）。
${PLATFORM_TREND_PRIORITY_FOR_FULLCASE.note}`;
}

export function composePlatformNetfeelFullcaseGuidance(): string {
  return [
    composePlatformTrendPriorityGuidance(),
    composePlatformNetfeelTitleGuidance(),
    composePlatformNetfeelCoverGuidance(),
  ].join("\n\n");
}

/** 出图短约束 */
export function composePlatformNetfeelImageSkillHint(): string {
  const shellIds = PLATFORM_NETFEEL_COVER_SHELLS.map((s) => s.id).join("/");
  const deviceLabels = PLATFORM_NETFEEL_TYPE_DEVICES.map((d) => d.labelZh).join("/");
  return `【网感封面·A1 过审集】壳轮换：${shellIds}；主句=coverHeadline。【排版手法·每张挑1–2个】${deviceLabels}；荧光只做小面积标注、英文只作装饰层、画中画 ≤1/4 画面。【配色池轮换】暖黄块/品红侧栏/真相红/吸睛绿/黑金/走心红/水蜜桃/玫瑰金/天蓝钴蓝/香槟琥珀——按壳选色，同批勿锁死单色；忌俗艳番茄红与荧光粉绿贴纸墙。【文案=表情】张口大吃/竖指/错愕坏笑/递物怼镜等；禁望窗外发呆，也禁面部过度用力。【好奇/价值钉】可用先做N件事、又挖到宝了、刷到就是赚到等开放环。【已剔除】飞人跳伞抽象摆拍、立体变形花字墙、封面写全答案剧透、字号过小、荧光撞色侧栏。`;
}
