import type { GrowthIndustryTemplate } from "@shared/growth";

type IndustryTemplateDefinition = GrowthIndustryTemplate & {
  keywords: string[];
  negativeKeywords?: string[];
};

const GENERIC_TEMPLATE: GrowthIndustryTemplate = {
  id: "generic-commercial",
  name: "通用商业化",
  audience: "对当前主题有明确痛点、愿意为更快结果付费的人群。",
  painPoint: "用户不是缺信息，而是缺更短路径、更可信案例和更明确的下一步动作。",
  positioningHint: "先把自己定义成解决某类问题的人，而不是泛内容创作者。",
  analysisHint: "内容要先回答“你解决什么问题、凭什么可信、下一步做什么”，不要把过程叙事当结论。",
  trustAsset: "优先展示结果、案例、对比、方法框架或服务边界。",
  primaryConversion: "优先跑通单一路径承接，例如咨询、商品、课程或服务预约。",
  commercialFocus: "不要同时堆多个变现方向，先把一个入口做深。",
  offerExamples: ["咨询预约", "案例页", "商品入口", "课程模板"],
};

const INDUSTRY_TEMPLATES: IndustryTemplateDefinition[] = [
  {
    id: "education-score",
    name: "教育培训提分",
    audience: "家长、学生，以及愿意为提分结果和学习效率付费的人群。",
    painPoint: "用户不缺鸡汤，缺可执行提分路径、时间规划和结果证明。",
    positioningHint: "定位成能把提分问题拆成步骤的人，而不是泛讲学习方法的人。",
    analysisHint: "优先突出提分结果、常见失分点、阶段性路径和适用人群，少讲空泛理念。",
    trustAsset: "成绩提升案例、阶段前后对比、试卷拆解、答疑记录。",
    primaryConversion: "咨询诊断、试听课、训练营、提分方案。",
    commercialFocus: "先成交单点提分需求，再延展长期陪跑和课程。",
    offerExamples: ["测评诊断", "试听课", "阶段提分营", "一对一答疑"],
    keywords: ["提分", "学习", "成绩", "考试", "中考", "高考", "升学", "教培", "辅导", "题型", "作业", "老师"],
  },
  {
    id: "business-consulting",
    name: "商业咨询",
    audience: "老板、管理者、创业者，以及愿意为增长和效率买单的决策人。",
    painPoint: "用户不缺观点，缺能直接落地的诊断、策略和案例参照。",
    positioningHint: "定位成能解决经营问题的顾问，而不是泛谈商业认知的博主。",
    analysisHint: "先讲业务问题和损失，再给判断框架、关键动作和成功案例。",
    trustAsset: "客户案例、诊断框架、增长复盘、交付前后对比。",
    primaryConversion: "咨询诊断、方案沟通、陪跑服务、高客单项目。",
    commercialFocus: "优先用案例和结果筛选高意向客户，不要把内容做成纯知识分享。",
    offerExamples: ["诊断通话", "顾问方案", "企业陪跑", "高管工作坊"],
    keywords: ["咨询", "顾问", "商业", "经营", "增长", "老板", "企业", "创业", "管理", "客户", "案例", "招商", "转化"],
  },
  {
    id: "personal-growth",
    name: "个人成长",
    audience: "想提升自律、表达、效率、认知和行动力的人群。",
    painPoint: "用户看过太多大道理，真正缺的是可执行的拆解和持续监督。",
    positioningHint: "定位成帮用户跨过具体卡点的人，而不是泛输出正能量的人。",
    analysisHint: "优先讲场景、误区、步骤和可验证结果，避免泛泛谈觉醒和改变。",
    trustAsset: "执行清单、阶段变化、复盘记录、训练模板。",
    primaryConversion: "训练营、陪跑、模板包、社群计划。",
    commercialFocus: "先让用户看到具体改善，再承接长期习惯和陪跑服务。",
    offerExamples: ["打卡计划", "训练营", "成长模板", "陪跑社群"],
    keywords: ["成长", "自律", "认知", "习惯", "效率", "表达", "复盘", "行动力", "改变", "提升"],
  },
  {
    id: "family-relationship",
    name: "家庭关系",
    audience: "关注亲密关系、婚姻沟通、亲子互动和家庭边界的人群。",
    painPoint: "用户最怕站队式说教，真正需要的是可执行的沟通语言和边界策略。",
    positioningHint: "定位成能处理具体关系冲突的人，而不是泛讲情绪价值的人。",
    analysisHint: "先点出现实冲突场景，再给一句可直接使用的话术或动作，少做空泛评判。",
    trustAsset: "关系场景拆解、真实对话范例、边界模板、咨询案例。",
    primaryConversion: "咨询、训练营、关系课程、私密社群。",
    commercialFocus: "先用高频冲突场景建立信任，再承接深度咨询和课程。",
    offerExamples: ["咨询预约", "沟通课", "亲密关系训练营", "亲子话术模板"],
    keywords: ["家庭", "婚姻", "夫妻", "亲子", "沟通", "关系", "孩子", "父母", "情绪", "边界"],
  },
  {
    id: "health-management",
    name: "健康管理",
    audience: "关注慢病管理、减脂、康复、生活方式和长期健康的人群。",
    painPoint: "用户不缺健康常识，缺把建议真正执行到生活中的方案。",
    positioningHint: "定位成能把健康问题翻译成日常方案的人，而不是泛科普账号。",
    analysisHint: "优先讲真实症状、风险、方案和执行难点，不要只做抽象知识搬运。",
    trustAsset: "病例或场景拆解、生活方式方案、指标变化、专业解释。",
    primaryConversion: "咨询、健康方案、课程、会员服务。",
    commercialFocus: "先建立专业可信度，再承接诊断、陪跑或长期管理。",
    offerExamples: ["健康评估", "管理方案", "随访服务", "主题课程"],
    keywords: ["健康", "慢病", "减脂", "康复", "医生", "医学", "营养", "睡眠", "运动损伤", "体检", "防晒", "持妆"],
  },
  {
    id: "offline-local-business",
    name: "实体线下",
    audience: "本地门店、线下服务和到店消费决策人群。",
    painPoint: "用户最担心踩坑和不值，真正需要的是到店前就能判断值不值得去。",
    positioningHint: "定位成能降低到店决策成本的人，而不是单纯拍环境的人。",
    analysisHint: "先讲适合谁、解决什么问题、价格区间和值不值得，再讲过程和氛围。",
    trustAsset: "到店前后对比、服务流程、价格说明、避坑点。",
    primaryConversion: "预约、到店体验、团购、私域预约。",
    commercialFocus: "先把高意向本地用户导向预约或到店，不要只追曝光。",
    offerExamples: ["预约入口", "到店体验", "套餐咨询", "团购转化"],
    keywords: ["线下", "门店", "探店", "到店", "实体", "本地", "餐饮", "美容院", "健身房", "门诊", "预约"],
  },
  {
    id: "ecommerce-seller",
    name: "电商卖家",
    audience: "想提升点击、转化、复购和客单价的卖家与店主。",
    painPoint: "用户不缺产品介绍，缺的是利益点排序、成交触发和信任证据。",
    positioningHint: "定位成帮用户快速完成购买判断的人，而不是泛介绍商品的人。",
    analysisHint: "先讲适用场景、核心利益点、差异化和购买理由，不要把故事讲得比商品更重。",
    trustAsset: "买家反馈、使用前后对比、场景演示、参数对比。",
    primaryConversion: "商品页、橱窗、套餐组合、私域复购。",
    commercialFocus: "优先跑通单品成交，再做组合、复购和会员。",
    offerExamples: ["单品爆款", "套装组合", "私域复购", "会员计划"],
    keywords: ["电商", "带货", "商品", "橱窗", "单品", "卖家", "店铺", "sku", "转化", "复购", "客单价"],
  },
  {
    id: "career-job",
    name: "职场求职",
    audience: "想提升面试、升职、职业表达和求职竞争力的人群。",
    painPoint: "用户最缺的是短时间内可见效果的表达和动作，而不是宏观建议。",
    positioningHint: "定位成能解决具体职场问题的人，而不是泛谈职场情绪的人。",
    analysisHint: "先讲什么场景会吃亏、怎么修、修完会有什么结果，再讲方法。",
    trustAsset: "面试案例、简历修改前后、表达模板、升职复盘。",
    primaryConversion: "咨询、简历服务、训练营、课程。",
    commercialFocus: "先用高频场景吸引，再承接高意向个体服务。",
    offerExamples: ["简历诊断", "面试模拟", "表达训练营", "求职陪跑"],
    keywords: ["职场", "求职", "简历", "面试", "升职", "跳槽", "职业", "表达", "汇报"],
  },
  {
    id: "finance-wealth",
    name: "财经理财",
    audience: "关注赚钱、理财、资产配置和生意判断的人群。",
    painPoint: "用户怕空泛概念，想知道这件事和自己的钱、风险、决策有什么关系。",
    positioningHint: "定位成能把复杂财经问题翻译成决策语言的人，而不是只讲宏观资讯的人。",
    analysisHint: "优先讲影响、判断、风险和动作，不要停在新闻复述。",
    trustAsset: "案例对照、账本拆解、风险提示、决策框架。",
    primaryConversion: "咨询、课程、会员、工具包。",
    commercialFocus: "先让用户感受到判断价值，再承接长期订阅或高信任服务。",
    offerExamples: ["理财课", "咨询服务", "会员订阅", "工具模板"],
    keywords: ["财经", "理财", "投资", "资产", "赚钱", "生意", "现金流", "财务", "经济"],
  },
  {
    id: "beauty-fashion",
    name: "美妆穿搭形象",
    audience: "关注妆容、护肤、穿搭、气质和个人形象表达的人群。",
    painPoint: "用户不缺审美参考，缺的是适合自己的场景方案和购买理由。",
    positioningHint: "定位成能把审美翻译成场景方案的人，而不是只做美图展示的人。",
    analysisHint: "优先讲什么场景、什么人、怎么选、怎么做，不要只做泛欣赏和赛事描述。",
    trustAsset: "场景示范、前后对比、清单、适用人群和避坑点。",
    primaryConversion: "品牌合作、商品转化、形象咨询、课程服务。",
    commercialFocus: "先把审美表达翻译成具体问题解决，再承接品牌、商品和服务。",
    offerExamples: ["形象咨询", "妆容方案", "品牌合作提案", "商品清单"],
    keywords: ["美妆", "穿搭", "形象", "护肤", "妆", "造型", "时尚", "发型", "气质", "网球穿搭", "防晒"],
  },
];

function tokenize(text: string) {
  return Array.from(new Set(String(text || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || [])).map((item) => item.toLowerCase());
}

export function matchIndustryTemplate(context: string, extras: string[] = []): GrowthIndustryTemplate {
  const haystack = tokenize([context, ...extras].join(" "));
  let bestScore = 0;
  let bestTemplate: IndustryTemplateDefinition | null = null;

  for (const template of INDUSTRY_TEMPLATES) {
    let score = 0;
    for (const keyword of template.keywords) {
      const normalized = keyword.toLowerCase();
      if (haystack.some((token) => token.includes(normalized) || normalized.includes(token))) score += 3;
    }
    for (const offer of template.offerExamples) {
      const normalized = offer.toLowerCase();
      if (haystack.some((token) => normalized.includes(token) || token.includes(normalized))) score += 1;
    }
    for (const keyword of template.negativeKeywords || []) {
      const normalized = keyword.toLowerCase();
      if (haystack.some((token) => token.includes(normalized) || normalized.includes(token))) score -= 4;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }

  return bestTemplate ? {
    id: bestTemplate.id,
    name: bestTemplate.name,
    audience: bestTemplate.audience,
    painPoint: bestTemplate.painPoint,
    positioningHint: bestTemplate.positioningHint,
    analysisHint: bestTemplate.analysisHint,
    trustAsset: bestTemplate.trustAsset,
    primaryConversion: bestTemplate.primaryConversion,
    commercialFocus: bestTemplate.commercialFocus,
    offerExamples: bestTemplate.offerExamples,
  } : GENERIC_TEMPLATE;
}
