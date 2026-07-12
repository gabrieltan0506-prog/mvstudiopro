/**
 * 平台官方活动 / 话题征稿策展种子。
 * 来源：创作者中心「官方活动」截图策展（2026-07）+ 既有扶持计划；
 * 其他平台同结构扩展。选题与趋势报表优先引用 featured=true。
 */

export type OfficialCampaignKind = "topic_challenge" | "traffic_support" | "festival";

export type OfficialCampaignCategory =
  | "summer_lifestyle"
  | "city_walk"
  | "fmcg_goods"
  | "wellness_sport"
  | "culture_reading"
  | "workplace"
  | "aesthetics_fashion"
  | "food_local"
  | "creator_incentive";

export type OfficialCampaignLaneHint = "fmcg" | "forensic" | "crossover" | "contrast" | "default";

export type OfficialCampaignSeed = {
  id: string;
  platform: "xiaohongshu" | "douyin" | "bilibili" | "kuaishou" | "toutiao";
  /** 展示名，含 # 话题或扶持计划名 */
  name: string;
  kind: OfficialCampaignKind;
  category: OfficialCampaignCategory;
  /** 是否精选进趋势报表 / 选题优先池 */
  featured: boolean;
  /** 与人设方向结合说明（康养哲学 / 古典审美 / 博物馆夏季生活等） */
  personaFit: string;
  /** 示例选题切口（生成时可改写） */
  topicHooks: string[];
  laneHints: OfficialCampaignLaneHint[];
  summary: string;
  status: "active" | "watch" | "expired";
  sourceNote: string;
  reviewedAt: string;
};

/** 小红书：官方话题活动精选（与康养×古典审美×城市生活方向可结合） */
export const XHS_OFFICIAL_CAMPAIGN_SEEDS: OfficialCampaignSeed[] = [
  {
    id: "xhs-summer-life-2026",
    platform: "xiaohongshu",
    name: "#我的暑假生活",
    kind: "topic_challenge",
    category: "summer_lifestyle",
    featured: true,
    personaFit: "暑期室内场馆/市集/展览合集；把康养节律写成可逛的暑假一天。",
    topicHooks: [
      "上海图东馆暑期市集｜室内花车怎么逛才不累",
      "哈佛底色的暑假：博物馆半日+晚间爵士，怎么排不透支",
    ],
    laneHints: ["default", "contrast"],
    summary: "暑假生活向官方话题：日记/合集/行程清单易收藏。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-city-walk-guide-2026",
    platform: "xiaohongshu",
    name: "#城市漫步指南",
    kind: "topic_challenge",
    category: "city_walk",
    featured: true,
    personaFit: "Citywalk + 美术馆/图书馆东馆路线；古典容器装当代生活节奏。",
    topicHooks: [
      "人民广场→上博东馆｜国宝展日的城市漫步清单",
      "西岸双展一日：他界之器+抽象，怎么走不赶场",
    ],
    laneHints: ["default", "crossover"],
    summary: "城市漫步攻略：路线+店+展，收藏率高。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-summer-cool-plan-2026",
    platform: "xiaohongshu",
    name: "#夏日清凉计划",
    kind: "topic_challenge",
    category: "summer_lifestyle",
    featured: true,
    personaFit: "清凉不等于乱喝冰饮；叠 fmcg 痛点槽点+权威一句。",
    topicHooks: [
      "会议室雪糕局｜先算糖账再谈清凉",
      "夏日清凉计划：室内展+凉感穿搭，少靠冰饮硬顶",
    ],
    laneHints: ["fmcg", "default"],
    summary: "夏日避暑/清凉：生活方式+饮品/护肤好物入口。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-this-is-my-life-2026",
    platform: "xiaohongshu",
    name: "#这就是我的生活",
    kind: "topic_challenge",
    category: "summer_lifestyle",
    featured: true,
    personaFit: "高净值日常切片：展/乐/食节律，不做鸡汤。",
    topicHooks: [
      "这就是我的生活：周五闭馆后一小时只留给一幅画",
      "把『慢』写进日程表：一场展+一顿松弛晚餐",
    ],
    laneHints: ["default", "contrast"],
    summary: "生活切片人设帖：真实日程>空泛励志。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-goods-rec-2026",
    platform: "xiaohongshu",
    name: "#好物推荐",
    kind: "topic_challenge",
    category: "fmcg_goods",
    featured: true,
    personaFit: "畅销品痛点槽点科普；翻标/量感/权威一句。",
    topicHooks: [
      "夏日货架｜这款冰饮的糖一天上限占比你算过吗",
      "好物推荐别只会『好用』：三步翻标看懂宣称",
    ],
    laneHints: ["fmcg", "forensic"],
    summary: "种草好物官方话题：适合测评/清单笔记。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-goods-review-2026",
    platform: "xiaohongshu",
    name: "#好物测评",
    kind: "topic_challenge",
    category: "fmcg_goods",
    featured: true,
    personaFit: "法医式细节看配料与体感，不做恐吓诊疗。",
    topicHooks: [
      "好物测评：同柜两款防晒，差别可能在这三行小字",
      "办公室零食测评｜『低负担』三个字值不值",
    ],
    laneHints: ["fmcg", "forensic"],
    summary: "测评向：对比/翻标/体感钉子。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-sport-daily-2026",
    platform: "xiaohongshu",
    name: "#我的运动日常",
    kind: "topic_challenge",
    category: "wellness_sport",
    featured: true,
    personaFit: "身体活动指南一句+可执行散步/力量；去临床恐吓。",
    topicHooks: [
      "看完马王堆再走路｜把『活动账』写进下班十分钟",
      "我的运动日常：不靠狠练，靠可重复的小顺序",
    ],
    laneHints: ["default", "forensic"],
    summary: "运动打卡官方话题：日常可拍、易完播。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-reading-notes-2026",
    platform: "xiaohongshu",
    name: "#读书笔记",
    kind: "topic_challenge",
    category: "culture_reading",
    featured: true,
    personaFit: "展签/典籍一句→当代生活对照；禁读论文口播。",
    topicHooks: [
      "读书笔记：从展签一句话，翻译成今晚能用的节律判断",
      "莎士比亚到罗琳展｜别只打卡，带走一条创作节律",
    ],
    laneHints: ["crossover", "default"],
    summary: "读书/文化笔记：适合博物馆延伸阅读帖。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-treasure-books-2026",
    platform: "xiaohongshu",
    name: "#我的宝藏书单",
    kind: "topic_challenge",
    category: "culture_reading",
    featured: false,
    personaFit: "书单作容器，落点仍是生活动作而非书评课。",
    topicHooks: ["三本不讲鸡汤的暑期书｜读完只改一件日常"],
    laneHints: ["default"],
    summary: "书单话题：可作文化线辅话题。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-food-checkin-2026",
    platform: "xiaohongshu",
    name: "#美食打卡",
    kind: "topic_challenge",
    category: "food_local",
    featured: true,
    personaFit: "展后一餐/市集摊位；可叠糖盐算账，勿恐吓。",
    topicHooks: ["东馆市集摊位｜好看之外，先看配料表前三名"],
    laneHints: ["fmcg", "default"],
    summary: "美食打卡：本地生活+轻科普入口。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-workplace-newbie-2026",
    platform: "xiaohongshu",
    name: "#职场新人指南",
    kind: "topic_challenge",
    category: "workplace",
    featured: false,
    personaFit: "高压会议后的身体账；强监管优化表达。",
    topicHooks: ["职场新人指南：会开不停时，先保命的三个身体动作"],
    laneHints: ["forensic", "default"],
    summary: "职场向：可写节律，忌诊疗承诺。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-summer-outfit-2026",
    platform: "xiaohongshu",
    name: "#夏日清爽穿搭",
    kind: "topic_challenge",
    category: "aesthetics_fashion",
    featured: false,
    personaFit: "看展穿搭=古典审美容器；少堆单品清单课。",
    topicHooks: ["看展日清爽穿搭｜少色块、多留白，镜头更干净"],
    laneHints: ["default", "contrast"],
    summary: "穿搭官方话题：审美线辅流量。",
    status: "active",
    sourceNote: "创作者中心官方活动列表·2026-07 截图策展",
    reviewedAt: "2026-07-13",
  },
  // 既有扶持计划（继续进报表）
  {
    id: "xhs-red-newgen-2026",
    platform: "xiaohongshu",
    name: "RED 新生代创作大赛 / 创作基金",
    kind: "traffic_support",
    category: "creator_incentive",
    featured: true,
    personaFit: "人格化原创、真诚分享冷启动；可与图文合集同发。",
    topicHooks: [],
    laneHints: ["default"],
    summary: "综合创作大赛：赛事流量+创作基金。",
    status: "active",
    sourceNote: "既有扶持注册表·web 复核",
    reviewedAt: "2026-07-13",
  },
  {
    id: "xhs-midlong-video-2026",
    platform: "xiaohongshu",
    name: "小红书中长视频激励 / 视频激励计划",
    kind: "traffic_support",
    category: "creator_incentive",
    featured: true,
    personaFit: "1.5–2 分钟讲解短视频（m2 密度）优先蹭此激励。",
    topicHooks: [],
    laneHints: ["default", "fmcg"],
    summary: "中长视频流量券/创作基金。",
    status: "active",
    sourceNote: "既有扶持注册表·web 复核",
    reviewedAt: "2026-07-13",
  },
];

/** 其他平台精选（结构同构，便于趋势报表一并生成） */
export const OTHER_PLATFORM_CAMPAIGN_SEEDS: OfficialCampaignSeed[] = [
  {
    id: "dy-ai-contest-2026",
    platform: "douyin",
    name: "抖音 AI 创作大赛 / AI 创作浪潮计划",
    kind: "traffic_support",
    category: "creator_incentive",
    featured: true,
    personaFit: "工具向叙事可借；康养主线仍用人设改写。",
    topicHooks: [],
    laneHints: ["default"],
    summary: "AI 创作官方征稿：现金+流量。",
    status: "active",
    sourceNote: "既有扶持注册表",
    reviewedAt: "2026-07-13",
  },
  {
    id: "dy-knowledge-2026",
    platform: "douyin",
    name: "抖音知识节 / 知识区流量扶持",
    kind: "traffic_support",
    category: "creator_incentive",
    featured: true,
    personaFit: "口播 1.5–2 分钟知识讲解；勿读论文。",
    topicHooks: ["会议室糖账｜90 秒讲清一日上限占比"],
    laneHints: ["fmcg", "default"],
    summary: "知识向征稿/加权。",
    status: "active",
    sourceNote: "既有扶持注册表",
    reviewedAt: "2026-07-13",
  },
  {
    id: "bili-task-center-2026",
    platform: "bilibili",
    name: "B站任务中心征稿（当月）",
    kind: "topic_challenge",
    category: "creator_incentive",
    featured: true,
    personaFit: "系列复盘/展评可投当月任务；短窗看任务中心。",
    topicHooks: ["上海七月三大展｜为什么只值你周末冲一场"],
    laneHints: ["default", "crossover"],
    summary: "月更征稿主题。",
    status: "active",
    sourceNote: "既有扶持注册表",
    reviewedAt: "2026-07-13",
  },
  {
    id: "ks-photosyn-2026",
    platform: "kuaishou",
    name: "快手光合计划与创作者成长扶持",
    kind: "traffic_support",
    category: "creator_incentive",
    featured: true,
    personaFit: "真实口播、强场景；同一套生活切口降维表达。",
    topicHooks: [],
    laneHints: ["default"],
    summary: "光合流量包。",
    status: "active",
    sourceNote: "既有扶持注册表",
    reviewedAt: "2026-07-13",
  },
];

export const ALL_OFFICIAL_CAMPAIGN_SEEDS: OfficialCampaignSeed[] = [
  ...XHS_OFFICIAL_CAMPAIGN_SEEDS,
  ...OTHER_PLATFORM_CAMPAIGN_SEEDS,
];

export function featuredOfficialCampaigns(platform?: string): OfficialCampaignSeed[] {
  return ALL_OFFICIAL_CAMPAIGN_SEEDS.filter(
    (c) => c.status === "active" && c.featured && (!platform || c.platform === platform),
  );
}

export function formatCampaignForReport(c: OfficialCampaignSeed): string {
  return `${c.name}：${c.summary}（结合方向：${c.personaFit}）`;
}

export function formatCampaignTopicExamples(limit = 8): Array<{
  campaign: string;
  title: string;
  lane: OfficialCampaignLaneHint;
  category: OfficialCampaignCategory;
}> {
  const out: Array<{
    campaign: string;
    title: string;
    lane: OfficialCampaignLaneHint;
    category: OfficialCampaignCategory;
  }> = [];
  for (const c of featuredOfficialCampaigns("xiaohongshu")) {
    for (const hook of c.topicHooks) {
      out.push({
        campaign: c.name,
        title: hook,
        lane: c.laneHints[0] || "default",
        category: c.category,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
