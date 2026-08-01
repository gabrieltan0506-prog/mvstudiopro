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
  | "manga_bold_stall";

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
表达：像朋友转述，不像培训讲师念稿。`;
}

/**
 * 夸张文案 ↔ 夸张表情/动作同拍 + A1 全量配色池。
 */
export function composePlatformNetfeelExpressionMatchGuidance(): string {
  return `【网感封面·文案张力 = 表情动作张力·硬门槛】
有人物时：**屏上文字有多拧，人物表情与肢体必须同档**，禁止「大字很野 + 人发呆望窗外/证件照微笑」。
同拍配对（择一，勿说明书堆叠）：
- 吃喝/减脂 → **张口大吃、鼓腮、叉子怼嘴、满足/惊喜**；「N件事」可竖指
- 反常识/真相壳 → 瞪大眼、错愕张嘴、坏笑、探身递证据
- 步骤/数字 → 比数、点桌、怼屏幕证据 + 笃定/得意
- 抽象冲击 → 失衡/跳跃/夸张递物，情绪可读
- 简约/情绪条 → 递物怼镜或坏笑「挖到宝」感
**禁止**：冷脸大片、望景发呆、正襟危坐与夸张标题同框；也禁另一头的「每块面部肌肉都在用力」的过度夸张。
${composeAccentPaletteGuidance()}
主字偏米白/象牙白；杀伤词用本条选定强调色（黄底块/侧栏粉/竖排红/吸睛绿/黑金/桃/玫瑰金/蓝/香槟金等）；可细笔刷下划线。字重可厚，但**禁止把主词做成立体变形花字**。`;
}

/** 封面出图：A1 全壳 + 表情同拍 + 配色池 */
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
${composeRejectedShellGuidance()}
${composePlatformNetfeelExpressionMatchGuidance()}
屏内字：中国大陆简体；杀伤字 2–6 个提亮。`;
}

/** trendStore 平台优先级说明 */
export function composePlatformTrendPriorityGuidance(): string {
  return `【trendStore 平台权重·全案】
主参考：**小红书（xiaohongshu）** 近窗 highEngagementSamples / recentTitles / tagCandidates。
辅参考：**B站（bilibili）** 与 **抖音（douyin）**——借节奏、反差与口语钩子；三者都读。
快手 / 视频号：可作补充，不决定主结构。
一律**禁止字面抄袭**样本标题；须改写到本人设。
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
  return `【网感封面·A1 过审集】壳轮换：${shellIds}；主句=coverHeadline。【配色池轮换】暖黄块/品红侧栏/真相红/吸睛绿/黑金/走心红/水蜜桃/玫瑰金/天蓝钴蓝/香槟琥珀——按壳选色，同批勿锁死单色；忌俗艳番茄红与荧光粉绿贴纸墙。【文案=表情】张口大吃/竖指/错愕坏笑/递物怼镜等；禁望窗外发呆，也禁面部过度用力。【好奇/价值钉】可用先做N件事、又挖到宝了、刷到就是赚到等开放环。【已剔除】飞人跳伞抽象摆拍、立体变形花字墙、封面写全答案剧透、字号过小、荧光撞色侧栏。`;
}
