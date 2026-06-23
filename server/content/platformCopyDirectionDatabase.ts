import type { GrowthPlatform } from "@shared/growth";

/** 爆款文章侧栏资料库集合（选题与文案方向） */
export type CopyDirectionCollectionKey =
  | "violationBlacklist"
  | "lexiconA"
  | "lexiconB"
  | "structureTemplates"
  | "weeklyTopicPack"
  | "candidatePool"
  | "learnerResources";

export type PlatformCopyDirectionBundle = {
  platform: GrowthPlatform;
  platformLabel: string;
  roleDefinition: string;
  coreKeywords: string[];
  keywordPlacementRule: string;
  titleTechniques: Array<{ id: number; name: string; description: string }>;
  buzzwordLibrary: string[];
  copyTemplates: Array<{ id: string; name: string; structure: string }>;
  systemRules: string[];
  workflowSteps: string[];
  collections: Record<CopyDirectionCollectionKey, string[]>;
};

const SHARED_TITLE_TECHNIQUES: PlatformCopyDirectionBundle["titleTechniques"] = [
  { id: 1, name: "吸睛型", description: "情绪词 + 程度副词，制造停留" },
  { id: 2, name: "直给型", description: "直接点题，不绕弯" },
  { id: 3, name: "数字型", description: "清单、排行、天数、次数" },
  { id: 4, name: "经历型", description: "真实故事 + 感受" },
  { id: 5, name: "效果型", description: "实用价值 + 结果对比" },
  { id: 6, name: "方法型", description: "直接指名方法 + 挑战旧认知" },
  { id: 7, name: "疑问型", description: "场景铺垫 + 引导思考" },
  { id: 8, name: "细节型", description: "具体细节 + 功效" },
  { id: 9, name: "测评型", description: "正反面 + 推荐方案" },
  { id: 10, name: "共鸣型", description: "情绪共振 + 身份认同" },
];

const SHARED_SYSTEM_RULES = [
  "标题控制在 15 字以内（不向用户暴露字数限制）",
  "每段开头或结尾配一个贴合语境的 emoji",
  "语气热情、口语化，避免硬广腔",
  "用具体动作与场景，不用空泛形容词",
  "分析特征与结构，不机械抄原文",
];

const SHARED_WORKFLOW = [
  "目标人群分析：输出关键词并请用户确认",
  "选题生成：表格 10 条（序号 / 选题 / 角度），用户勾选或补充",
  "标题生成：表格 10 条（序号 / 技巧1 / 技巧2 / 爆款词 / 标题），用户勾选",
  "模板规划：表格（序号 / 模板 / 结构 / 前两句话），用户选定或给范例",
  "成稿输出：套用标题与模板，文末加 #关键词",
];

const BASE_VIOLATION_BLACKLIST = [
  "保证100%有效",
  "国家级认证",
  "七天必瘦",
  "Medical miracle",
  "绝对安全无副作用",
];

function fitnessShapingBase(platformLabel: string): Omit<PlatformCopyDirectionBundle, "platform" | "platformLabel"> {
  return {
    roleDefinition: `女性运动塑形工作室${platformLabel}知识博主 + 专业私教；擅长社媒写作、营销推广，能精准分析目标人群痛点。`,
    coreKeywords: ["女性塑形", "女生运动", "减肥", "私教", "蜜桃臀", "塑形工作室"],
    keywordPlacementRule: "标题必须含关键词；正文开头、中段、结尾各自然出现一次核心词。",
    titleTechniques: SHARED_TITLE_TECHNIQUES,
    buzzwordLibrary: [
      "好用到哭",
      "教科书般",
      "小白必看",
      "宝藏",
      "划重点",
      "YYDS",
      "我不允许",
      "压箱底",
      "建议收藏",
      "停止摆烂",
      "手把手",
    ],
    copyTemplates: [
      {
        id: "problem-solving",
        name: "问题解决型",
        structure: "痛点描述 → 解决方案 → 对比效果",
      },
      {
        id: "human-nature",
        name: "顺应人性型",
        structure: "人性弱点 → 知识特性 → 放大效果",
      },
      {
        id: "audience-positioning",
        name: "人群定位型",
        structure: "目标人群 → 前后对比 → 使用流程/结果",
      },
    ],
    systemRules: SHARED_SYSTEM_RULES,
    workflowSteps: SHARED_WORKFLOW,
    collections: {
      violationBlacklist: [...BASE_VIOLATION_BLACKLIST, "最火减肥法", "躺瘦神器"],
      lexiconA: ["直角肩", "核心收紧", "体态矫正", "燃脂心率", "骨盆前倾", "假胯宽"],
      lexiconB: ["姐妹", "真的绝了", "亲测有效", "谁懂啊", "抄作业", "氛围感"],
      structureTemplates: [
        "封面：适合谁 + 解决什么 + 为什么值得收藏",
        "痛点3条 → 方法3步 → 对比1组 → 行动1句",
        "清单体：装备 / 动作 / 频率 / 避坑",
      ],
      weeklyTopicPack: [
        "久坐上班族 7 天薄背计划",
        "小基数女生如何练出蜜桃臀",
        "私教课 vs 自练：哪项最划算",
        "塑形期饮食：不节食怎么掉秤",
        "产后恢复：从核心到臀腿的顺序",
      ],
      candidatePool: [
        "为什么你练了腹还像怀孕？",
        "3 个动作改善假胯宽（跟练版）",
        "私教不会告诉你的练臀顺序",
        "女生健身房避坑清单",
        "小个子塑形穿搭 + 训练组合",
      ],
      learnerResources: [
        "拍摄：自然侧光 + 手机支架正面对拍",
        "封面字体：大标题 3-5 字 + 高对比底色",
        "发布节奏：工作日 12:00 / 20:30 测试",
      ],
    },
  };
}

const PLATFORM_COPY_DIRECTION_DB: Partial<Record<GrowthPlatform, PlatformCopyDirectionBundle>> = {
  xiaohongshu: {
    platform: "xiaohongshu",
    platformLabel: "小红书",
    ...fitnessShapingBase("小红书"),
  },
  douyin: {
    platform: "douyin",
    platformLabel: "抖音",
    roleDefinition: "同城运动塑形短视频教练 + 结果导向型口播博主。",
    coreKeywords: ["减脂", "瘦肚子", "跟练", "私教", "燃脂", "塑形"],
    keywordPlacementRule: "前 2 秒口播或字幕必须出现核心词；结尾 CTA 再带一次。",
    titleTechniques: SHARED_TITLE_TECHNIQUES,
    buzzwordLibrary: ["谁懂啊", "真的绝了", "救命", "太狠了", "别划走", "结果前置", "同城", "今日跟练"],
    copyTemplates: [
      { id: "problem-solving", name: "问题解决型", structure: "结果前置 → 痛点一句 → 动作演示 → 关注/私信" },
      { id: "human-nature", name: "顺应人性型", structure: "人性懒惰/焦虑 → 最小行动 → 15 秒可见变化" },
      { id: "audience-positioning", name: "人群定位型", structure: "点名人群 → 前后对比 → 到店/私信引导" },
    ],
    systemRules: [...SHARED_SYSTEM_RULES, "前 2 秒必须给结果或反差", "单条只留一个行动指令"],
    workflowSteps: SHARED_WORKFLOW,
    collections: {
      violationBlacklist: [...BASE_VIOLATION_BLACKLIST, "七天瘦十斤", "医学奇迹"],
      lexiconA: ["HIIT", "核心激活", "代谢", "热量缺口", "跟练", "同城体验课"],
      lexiconB: ["家人们", "真的", "别划走", "评论区", "今天就开始"],
      structureTemplates: [
        "[00:00-00:02] 结果/反差字幕",
        "[00:02-00:12] 痛点 + 动作1",
        "[00:12-00:25] 动作2-3 + 口播",
        "[结尾] 单一 CTA",
      ],
      weeklyTopicPack: [
        "15 秒瘦腰跟练（办公室版）",
        "小基数 3 动作燃脂",
        "私教体验课怎么问才不亏",
        "假胯宽改善跟练",
        "塑形期外卖怎么点",
      ],
      candidatePool: [
        "为什么你越练越壮？",
        "3 个错误练臀动作",
        "小个子显腿长训练组合",
        "下班 10 分钟燃脂",
        "同城私教避坑",
      ],
      learnerResources: ["竖屏 9:16", "字幕同步口播", "封面用大号结果字"],
    },
  },
  bilibili: {
    platform: "bilibili",
    platformLabel: "B站",
    roleDefinition: "运动科学向 UP 主 + 系统化训练方法论讲解者。",
    coreKeywords: ["健身科普", "训练计划", "体态", "力量训练", "塑形原理", "避坑"],
    keywordPlacementRule: "标题可稍长；封面 + 前 30 秒必须讲清「看完得到什么」。",
    titleTechniques: SHARED_TITLE_TECHNIQUES,
    buzzwordLibrary: ["全网最细", "保姆级", "深度复盘", "小白入门", "误区", "原理", "系列更新"],
    copyTemplates: [
      { id: "problem-solving", name: "问题解决型", structure: "问题定义 → 原理拆解 → 训练方案 → 总结" },
      { id: "human-nature", name: "顺应人性型", structure: "常见误区 → 为什么失败 → 可坚持方案" },
      { id: "audience-positioning", name: "人群定位型", structure: "人群画像 → 阶段目标 → 周计划" },
    ],
    systemRules: [...SHARED_SYSTEM_RULES, "必须给过程与依据，不能只给结论", "适合系列化栏目命名"],
    workflowSteps: SHARED_WORKFLOW,
    collections: {
      violationBlacklist: [...BASE_VIOLATION_BLACKLIST, "包治", "唯一正确"],
      lexiconA: ["渐进超负荷", "RM", "动作模式", "可恢复性", "训练容量", "体态评估"],
      lexiconB: ["干货", "收藏", "下期", "案例", "实测", "复盘"],
      structureTemplates: [
        "引子：一个反常识问题",
        "3 段原理 + 1 段案例",
        "训练表 + 常见错误",
        "总结 + 系列预告",
      ],
      weeklyTopicPack: [
        "蜜桃臀训练顺序全解析",
        "小基数增肌 vs 减脂怎么选",
        "私教课值不值：成本拆解",
        "久坐体态纠正 4 周计划",
        "女生力量训练入门误区",
      ],
      candidatePool: [
        "为什么侧踢练不出臀？",
        "硬拉/back 训练顺序",
        "塑形期蛋白怎么吃",
        "从 0 到 1 健身房流程",
        "如何自测骨盆前倾",
      ],
      learnerResources: ["60-120 秒结构清晰", "章节时间戳", "置顶评论放训练表"],
    },
  },
  kuaishou: {
    platform: "kuaishou",
    platformLabel: "快手",
    roleDefinition: "接地气女性塑形教练 + 同城生活服务型口播博主。",
    coreKeywords: ["减肥", "瘦肚子", "私教", "同城", "真实体验", "跟练"],
    keywordPlacementRule: "开头直给「值不值/适不适合」；结尾引导评论或到店。",
    titleTechniques: SHARED_TITLE_TECHNIQUES,
    buzzwordLibrary: ["老铁", "真实", "不忽悠", "亲身体验", "同城", "划算", "今天就练"],
    copyTemplates: [
      { id: "problem-solving", name: "问题解决型", structure: "生活场景痛点 → 简单动作 → 真实反馈" },
      { id: "human-nature", name: "顺应人性型", structure: "懒人/忙人困境 → 最省事做法 → 结果" },
      { id: "audience-positioning", name: "人群定位型", structure: "点名宝妈/上班族 → 前后变化 → 私信/到店" },
    ],
    systemRules: [...SHARED_SYSTEM_RULES, "少术语多生活场景", "强调真实口播与价格感"],
    workflowSteps: SHARED_WORKFLOW,
    collections: {
      violationBlacklist: [...BASE_VIOLATION_BLACKLIST, "包瘦", "无效退款"],
      lexiconA: ["跟练", "同城", "体验课", "核心", "瘦腰", "直腿"],
      lexiconB: ["姐妹们", "说实话", "真练过", "不骗人", "评论区问我"],
      structureTemplates: [
        "门口/厨房/客厅真实场景开场",
        "3 个动作边做边讲",
        "一句总结 + 评论互动",
      ],
      weeklyTopicPack: [
        "宝妈在家 10 分钟瘦腰",
        "快手跟练：练臀不粗腿",
        "私教课怎么谈价格",
        "小饭店怎么吃也不胖",
        "同城塑形体验分享",
      ],
      candidatePool: [
        "为什么你练了还不瘦？",
        "3 个免费动作改善假胯宽",
        "我上了私教课的真实感受",
        "下班路上 5 分钟拉伸",
        "快手直播前怎么热身",
      ],
      learnerResources: ["竖屏真实场景", "口播大于精修", "直播可预告跟练"],
    },
  },
};

const CORE_PLATFORMS: GrowthPlatform[] = ["xiaohongshu", "douyin", "bilibili", "kuaishou"];

export function getPlatformCopyDirectionBundle(platform: GrowthPlatform): PlatformCopyDirectionBundle | null {
  return PLATFORM_COPY_DIRECTION_DB[platform] ?? null;
}

export function listPlatformCopyDirectionBundles(
  platforms: GrowthPlatform[] = CORE_PLATFORMS,
): PlatformCopyDirectionBundle[] {
  return platforms.map((p) => getPlatformCopyDirectionBundle(p)).filter(Boolean) as PlatformCopyDirectionBundle[];
}

/** 压缩为 Stage2 / Gemini 可读的选题文案方向块 */
export function buildPlatformCopyDirectionPromptBlock(opts: {
  platforms: GrowthPlatform[];
  userContext?: string;
}): string {
  const bundles = listPlatformCopyDirectionBundles(opts.platforms);
  if (bundles.length === 0) return "";

  const lines: string[] = [
    "【平台选题与文案方向数据库 · 爆款文章】",
    "以下资料库用于选题、标题、结构与成稿；须结合 user context 人设改写，禁止脱离账号背景硬套健身范例。",
  ];
  if (opts.userContext?.trim()) {
    lines.push(`【账号背景】${opts.userContext.trim().slice(0, 800)}`);
  }

  for (const b of bundles) {
    lines.push(`\n## ${b.platformLabel}（${b.platform}）`);
    lines.push(`角色：${b.roleDefinition}`);
    lines.push(`核心关键词：${b.coreKeywords.join("、")}`);
    lines.push(`关键词规则：${b.keywordPlacementRule}`);
    lines.push(
      `标题技巧（任选其二组合）：${b.titleTechniques.map((t) => `${t.id}.${t.name}`).join("；")}`,
    );
    lines.push(`爆款词库：${b.buzzwordLibrary.join("、")}`);
    lines.push(
      `文案模板：${b.copyTemplates.map((t) => `${t.name}(${t.structure})`).join(" | ")}`,
    );
    lines.push(`系统规则：${b.systemRules.join("；")}`);
    lines.push(`工作流程：${b.workflowSteps.join(" → ")}`);
    lines.push("资料库集合：");
    const colLabels: Record<CopyDirectionCollectionKey, string> = {
      violationBlacklist: "违规词黑名单",
      lexiconA: "A词库",
      lexiconB: "B词库",
      structureTemplates: "结构模板库",
      weeklyTopicPack: "本周选题包",
      candidatePool: "候选池",
      learnerResources: "学员资料库",
    };
    for (const [key, label] of Object.entries(colLabels) as [CopyDirectionCollectionKey, string][]) {
      const items = b.collections[key];
      if (items?.length) lines.push(`- ${label}：${items.slice(0, 8).join("；")}`);
    }
  }

  return lines.join("\n");
}

export function getCopyDirectionCollectionSummary(): Array<{
  platform: GrowthPlatform;
  platformLabel: string;
  collections: Array<{ key: CopyDirectionCollectionKey; label: string; count: number }>;
}> {
  const colLabels: Record<CopyDirectionCollectionKey, string> = {
    violationBlacklist: "违规词黑名单",
    lexiconA: "A词库",
    lexiconB: "B词库",
    structureTemplates: "结构模板库",
    weeklyTopicPack: "本周选题包",
    candidatePool: "候选池",
    learnerResources: "学员资料库",
  };
  return listPlatformCopyDirectionBundles().map((b) => ({
    platform: b.platform,
    platformLabel: b.platformLabel,
    collections: (Object.keys(colLabels) as CopyDirectionCollectionKey[]).map((key) => ({
      key,
      label: colLabels[key],
      count: b.collections[key]?.length ?? 0,
    })),
  }));
}
