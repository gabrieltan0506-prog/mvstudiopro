import type { GrowthPlatform } from "@shared/growth";

type PlatformTemplate = {
  platform: GrowthPlatform;
  audienceProfile: string;
  contentPreference: string;
  packagingRule: string;
  conversionRule: string;
  actionRule: string;
};

const PLATFORM_TEMPLATES: Partial<Record<GrowthPlatform, PlatformTemplate>> = {
  douyin: {
    platform: "douyin",
    audienceProfile: "偏即时决策、强情绪反馈、低耐心的人群。",
    contentPreference: "结果前置、冲突强、反差明显、镜头推进快。",
    packagingRule: "开头 2 秒必须先给结果、反差或一句结论，不能慢热铺垫。",
    conversionRule: "更适合单品转化、强 CTA、私信咨询和短链路成交。",
    actionRule: "先做强钩子版，再压缩正文，只留一个结尾动作。",
  },
  xiaohongshu: {
    platform: "xiaohongshu",
    audienceProfile: "偏审美判断、收藏决策、方法参考和生活方式消费的人群。",
    contentPreference: "模板感、拆解感、清单感、前后对比和适用人群说明。",
    packagingRule: "封面和首屏要直接说明“适合谁、解决什么、为什么值得收藏”。",
    conversionRule: "更适合品牌合作、清单转化、咨询预约和方法型内容承接。",
    actionRule: "先做拆解版、模板版和收藏版表达，不要只放好看画面。",
  },
  kuaishou: {
    platform: "kuaishou",
    audienceProfile: "偏真实感、直给表达、生活场景和低门槛信任的人群。",
    contentPreference: "接地气、少修饰、场景真实、利益点明确、语气直接。",
    packagingRule: "不要端着讲，直接讲值不值、适不适合、怎么做更省事。",
    conversionRule: "更适合到店、商品、咨询或强结果服务的直接承接。",
    actionRule: "弱化概念包装，强化真实场景、结果和一句话利益点。",
  },
  bilibili: {
    platform: "bilibili",
    audienceProfile: "偏愿意花时间理解、接受复盘、教程和案例拆解的人群。",
    contentPreference: "完整叙事、案例复盘、幕后讲解、方法推导和误区分析。",
    packagingRule: "允许更完整的信息展开，但结构必须清楚，不能散。",
    conversionRule: "更适合课程、咨询、案例页、长尾信任积累和系列内容承接。",
    actionRule: "优先做复盘版和方法版，把单条内容延展成系列。",
  },
};

const GENERIC_PLATFORM_TEMPLATE: PlatformTemplate = {
  platform: "weixin_channels",
  audienceProfile: "偏熟人信任或已有主题兴趣的人群。",
  contentPreference: "信息清楚、利益点明确、节奏稳定。",
  packagingRule: "先讲价值，再讲过程。",
  conversionRule: "承接动作要单一，不要同时推多个方向。",
  actionRule: "保留核心卖点，按平台语境单独改写。",
};

export function getPlatformTemplate(platform: GrowthPlatform): PlatformTemplate {
  return PLATFORM_TEMPLATES[platform] || {
    ...GENERIC_PLATFORM_TEMPLATE,
    platform,
  };
}
