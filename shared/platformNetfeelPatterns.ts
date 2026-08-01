/**
 * 全案选题「网感」正向句式 + 封面壳（学结构，不抄竞品 UI/商标）。
 * 样本课：~/Downloads/2026Aug01/A1-netfeel-highlights.md + 趋势长图左下/右下。
 * 口径：小红书 trendStore 为主，B站 / 抖音为辅，三者都参考；4A 医疗向仍叠审核友好。
 */

/** 全案读 trend 时的平台权重（注入 Stage2 user JSON + system） */
export const PLATFORM_TREND_PRIORITY_FOR_FULLCASE = {
  primary: ["xiaohongshu"] as const,
  secondary: ["bilibili", "douyin"] as const,
  note:
    "选题钩子与封面气质优先对齐小红书近窗 highEngagementSamples；B站与抖音同批参考节奏/反差，禁止抄原标题；快手/视频号可作补充，不抢主结构。",
} as const;

export type PlatformNetfeelTitlePatternId =
  | "bracket_pipe_contrast"
  | "authority_oral_punch"
  | "metaphor_poison_desire"
  | "season_life_vibe"
  | "action_then_progress"
  | "self_deprecating_office"
  | "number_twist_result";

export type PlatformNetfeelTitlePattern = {
  id: PlatformNetfeelTitlePatternId;
  /** 内部标签，勿对用户展示技术栈名 */
  labelZh: string;
  /** 句式骨架；[方括号] 钉关键词；｜ 切两拍 */
  skeleton: string;
  /** 气质对标（改写到本人设，勿照抄） */
  vibeExamples: string[];
};

/** 生活烟火气 + 强反差 + 幽默吸睛 标题句式库 */
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
];

export type PlatformNetfeelCoverShellId =
  | "flank_keyword"
  | "steps_result"
  | "truth_vertical"
  | "big_topic_warn"
  | "question_fork"
  | "life_stall_vibe"
  | "abstract_stunt"
  | "deform_tension";

export type PlatformNetfeelCoverShell = {
  id: PlatformNetfeelCoverShellId;
  labelZh: string;
  /** 出图短指令 */
  visualHint: string;
};

/** A1 网感封面壳（同批轮换；允许变形字张力 · 用户选 2B） */
export const PLATFORM_NETFEEL_COVER_SHELLS: PlatformNetfeelCoverShell[] = [
  {
    id: "flank_keyword",
    labelZh: "左右竖排关键词夹人脸",
    visualHint:
      "人脸居中；左右或上下侧栏各 2 字级粗描边大字夹人；中部黄/霓虹底短钩一句；关键字高对比色。",
  },
  {
    id: "steps_result",
    labelZh: "N步+结果场景",
    visualHint:
      "顶栏身份/人名大白字；主句「N步+同城/结果场景」；数字用黄底提亮；生活/门店场域证据。",
  },
  {
    id: "truth_vertical",
    labelZh: "背后巨大竖排真相字",
    visualHint:
      "背后超大竖排红/霓虹「真相」类 2 字级关键词（可轻微变形立体）；前景一行反常识副句；人像有戏。",
  },
  {
    id: "big_topic_warn",
    labelZh: "类目大字+因果钉子",
    visualHint:
      "顶栏类目大字（如养生/职场）；中部因果/反差杀伤句；少字大字，忌病名恐吓墙。",
  },
  {
    id: "question_fork",
    labelZh: "机会/劫难二选一提问",
    visualHint: "黄白提问大字占上半屏；普通人视角二选一；底角可极小水印气质，勿标签墙。",
  },
  {
    id: "life_stall_vibe",
    labelZh: "便利店/市井烟火气",
    visualHint:
      "便利店货架、家装现场、哄娃客厅等烟火气证据画面；黄底粗标+白描边副句；禁空书房讲课脸。",
  },
  {
    id: "abstract_stunt",
    labelZh: "抽象营销夸张动作",
    visualHint:
      "荒诞但可读的冲击定格（失衡飞人/跳伞感/夸张递物）；短钩一句；同批最多 1–2 条用此壳。",
  },
  {
    id: "deform_tension",
    labelZh: "变形文字张力（2B）",
    visualHint:
      "允许主关键词用厚描边/轻微倾斜/立体渐变增加张力；仍须可读、服务 coverHeadline；禁止满屏花字说明书墙。",
  },
];

/** Stage2 / 初选 / 决策智库共用：网感标题引导 */
export function composePlatformNetfeelTitleGuidance(): string {
  const lines = PLATFORM_NETFEEL_TITLE_PATTERNS.map(
    (p, i) =>
      `${i + 1}. ${p.labelZh}（${p.id}）：骨架「${p.skeleton}」· 气质例：${p.vibeExamples[0]}`,
  );
  return `【网感标题·生活烟火气 + 强反差 + 幽默吸睛·硬门槛】
全案选题 title / hook / coverHeadline 须活泼生动，优先信息流口语，禁止干巴论文腔与「正确打开方式」无聊题。
句式库（改写到本人设与赛道，**禁止照抄例句**；同批 6 条尽量覆盖 ≥4 种不同 id）：
${lines.join("\n")}
结构偏好：可用 \`[关键词]\` 钉搜索/痛点词，用全角 \`｜\` 切「共鸣拍｜结果/行动拍」；情绪形容词 + 具体场景（工位咖啡、便利店、夏天多喝、加班边界）。
配额：同批至少 **4/6** 条明显含烟火气场景或自嘲幽默或隐喻反差；coverHeadline 仍须短、拧、可单独停滑。
表达：像朋友转述，不像培训讲师念稿。`;
}

/**
 * 夸张文案 ↔ 夸张表情/动作同拍（用户 2026-08-01 明文）+ 高级不俗配色。
 * 注入封面出图 / Skill 短约束 / Stage2 网感壳。
 */
export function composePlatformNetfeelExpressionMatchGuidance(): string {
  return `【网感封面·文案张力 = 表情动作张力·硬门槛】
有人物时：**屏上文字有多拧/多夸张，人物表情与肢体必须同档位配合**，禁止「大字很野 + 人发呆望窗外/证件照微笑」。
同拍配对（择一写进画面，勿说明书堆叠）：
- 吃喝/减脂/午餐反差 → **张口大吃、鼓腮咀嚼、叉子怼嘴、满足眯眼或夸张惊喜**，身体微前倾「正在发生」
- 反常识断言 → 瞪大眼不信、错愕张嘴、坏笑摇头、探身递证据
- 数字拧巴/步骤结果 → 手指比数、点桌、亮手机屏幕证据 + 笃定或得意表情
- 抽象冲击壳 → 失衡/跳跃/夸张递物，表情仍须可读情绪
**禁止**：冷脸大片、望景发呆、正襟危坐、端杯假笑与夸张标题同框。
【高级不俗·配色字效】
停滑靠构图与表情，不靠廉价霓虹贴纸感。配色偏**杂志高级**：米白/象牙白主字 + **单一**香槟金或暖琥珀提亮杀伤词（可细笔刷下划线）；侧栏关键词用克制白/浅金描边。
**避免**：荧光粉绿撞色墙、厚塑料贴纸字、三色以上抢戏、便利店价签堆叠感。变形字可有轻微厚描边/立体，但气质要精致可读。`;
}

/** 封面出图：网感壳 + 变形字（2B）+ 表情同拍 + 高级不俗 */
export function composePlatformNetfeelCoverGuidance(): string {
  const shells = PLATFORM_NETFEEL_COVER_SHELLS.map(
    (s) => `- ${s.id}（${s.labelZh}）：${s.visualHint}`,
  ).join("\n");
  return `【网感封面壳·A1 密度课对齐】
竖版信息流封面须从下列壳中**选一主壳**（同批六条轮换，禁止六条同壳）：
${shells}
版式张力（用户口径 2B）：允许侧栏大字、背后竖排关键词、**克制**暖金/琥珀提亮块、主词**轻微变形/厚描边/立体感**以增强停滑；主信息仍服务 coverHeadline，**禁止**百科多图标墙与 CTA 墙。
${composePlatformNetfeelExpressionMatchGuidance()}
画面优先：真人**正在做事**的有戏表情（含张口大吃等）+ 烟火气场域或抽象冲击二选一；禁正襟危坐培训脸。
屏内字：中国大陆简体；杀伤字 2–6 个提亮。`;
}

/** trendStore 平台优先级说明（Stage2 system + user JSON） */
export function composePlatformTrendPriorityGuidance(): string {
  return `【trendStore 平台权重·全案】
主参考：**小红书（xiaohongshu）** 近窗 highEngagementSamples / recentTitles / tagCandidates——对齐钩子结构、信息密度、收藏向切口。
辅参考：**B站（bilibili）** 与 **抖音（douyin）**——借节奏、反差力度与口语钩子；三者都读，禁止只盯一个平台复读。
快手 / 视频号：可作补充，不决定主结构。
一律**禁止字面抄袭**样本标题；须改写到本人设。
${PLATFORM_TREND_PRIORITY_FOR_FULLCASE.note}`;
}

/** 合并注入：标题 + 封面 + trend 权重（文案链） */
export function composePlatformNetfeelFullcaseGuidance(): string {
  return [
    composePlatformTrendPriorityGuidance(),
    composePlatformNetfeelTitleGuidance(),
    composePlatformNetfeelCoverGuidance(),
  ].join("\n\n");
}

/** 出图短约束（拼进 composePlatformImageSkillHints） */
export function composePlatformNetfeelImageSkillHint(): string {
  return `【网感封面·A1壳】从 flank_keyword / steps_result / truth_vertical / big_topic_warn / question_fork / life_stall_vibe / abstract_stunt / deform_tension 选一主壳；主句=coverHeadline。【文案=表情】文字多拧则人物须同档动作表情（吃喝向：张口大吃/鼓腮/叉子怼嘴；反常识：错愕坏笑；禁望窗外发呆）。【高级不俗】米白+单一香槟金/暖琥珀提亮，忌荧光粉绿贴纸俗气；侧栏/竖排可有，但精致可读。`;
}
