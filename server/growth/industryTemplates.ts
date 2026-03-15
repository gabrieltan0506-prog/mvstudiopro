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
  {
    id: "mother-baby",
    name: "母婴育儿",
    audience: "备孕、孕期、宝妈宝爸和关注育儿效率、安全与陪伴质量的人群。",
    painPoint: "用户不缺碎片经验，缺按月龄、场景和问题拆清楚的执行方案。",
    positioningHint: "定位成能把育儿问题拆成可执行动作的人，而不是泛分享情绪的人。",
    analysisHint: "先讲孩子阶段、常见卡点和可操作方案，再给用品、流程或沟通模板。",
    trustAsset: "月龄分段经验、真实场景记录、用品清单、儿科或育儿专业依据。",
    primaryConversion: "咨询、课程、清单包、社群陪伴服务。",
    commercialFocus: "先用高频育儿场景建立信任，再承接长期陪伴或母婴产品转化。",
    offerExamples: ["月龄清单", "育儿咨询", "课程营", "母婴产品方案"],
    keywords: ["母婴", "育儿", "宝宝", "婴儿", "辅食", "喂养", "早教", "宝妈", "宝爸", "孕期"],
  },
  {
    id: "emotion-psychology",
    name: "情感心理",
    audience: "关注情绪稳定、关系修复、自我疗愈和心理韧性的人群。",
    painPoint: "用户最怕泛安慰，真正需要的是能落到具体关系和情绪场景的处理方法。",
    positioningHint: "定位成能把心理与关系问题翻译成行动策略的人，而不是只输出共鸣文案的人。",
    analysisHint: "先点出典型情绪和关系场景，再给判断框架、边界动作或沟通话术。",
    trustAsset: "咨询场景拆解、对话模板、误区纠正、心理学依据。",
    primaryConversion: "咨询、训练营、课程、会员陪伴。",
    commercialFocus: "先用高频痛点建立信任，再承接更高信任度的咨询和长期服务。",
    offerExamples: ["沟通模板", "咨询预约", "情绪训练营", "会员陪伴"],
    keywords: ["情感", "情绪", "焦虑", "心理", "疗愈", "亲密关系", "分手", "抑郁", "治愈"],
  },
  {
    id: "ai-tools-software",
    name: "AI工具软件",
    audience: "想用 AI、自动化和软件工具提升效率、降低成本的个人与团队。",
    painPoint: "用户不缺新工具名字，缺的是按业务场景筛选、落地和集成方法。",
    positioningHint: "定位成能把工具变成工作流的人，而不是只做新鲜感测评的人。",
    analysisHint: "先讲什么问题被解决、节省什么成本、落地步骤是什么，再展示功能。",
    trustAsset: "工作流案例、前后效率对比、模板、实操演示。",
    primaryConversion: "咨询、课程、模板包、软件分销或服务交付。",
    commercialFocus: "先跑通高价值场景，再承接模板、陪跑和 SaaS 合作。",
    offerExamples: ["自动化咨询", "提示词模板", "工作流课程", "软件分销"],
    keywords: ["ai", "工具", "软件", "自动化", "工作流", "提示词", "saas", "效率", "智能体"],
  },
  {
    id: "digital-tech",
    name: "数码科技",
    audience: "关注手机、电脑、数码设备、效率硬件和科技生活方式的人群。",
    painPoint: "用户最缺的是购买判断、使用差异和长期体验，而不是参数堆砌。",
    positioningHint: "定位成能帮用户做决策的人，而不是只做开箱的人。",
    analysisHint: "先讲适合谁、场景、优缺点和购买边界，再讲参数和体验。",
    trustAsset: "对比测评、长期使用反馈、参数解释、场景演示。",
    primaryConversion: "品牌合作、商品分销、咨询、内容会员。",
    commercialFocus: "优先跑通测评决策类内容，再承接品牌、商品和配件转化。",
    offerExamples: ["测评报告", "选购清单", "品牌合作", "购买链接"],
    keywords: ["数码", "手机", "电脑", "平板", "耳机", "科技", "芯片", "测评", "开箱", "配置"],
  },
  {
    id: "home-living",
    name: "家居家装",
    audience: "关注装修、软装、收纳、清洁、居家效率和生活空间优化的人群。",
    painPoint: "用户不缺好看图片，缺适合自家户型和预算的方案与避坑判断。",
    positioningHint: "定位成能把空间问题解决掉的人，而不是只做灵感展示的人。",
    analysisHint: "先讲户型/预算/场景，再给方案、清单和避坑点。",
    trustAsset: "前后对比、预算清单、施工/布置过程、踩坑复盘。",
    primaryConversion: "咨询、清单、带货、品牌合作。",
    commercialFocus: "先用真实空间改造建立信任，再承接产品和服务转化。",
    offerExamples: ["家装咨询", "软装清单", "收纳改造", "品牌合作"],
    keywords: ["家居", "装修", "软装", "收纳", "清洁", "户型", "改造", "家装"],
  },
  {
    id: "auto-travel",
    name: "汽车出行",
    audience: "关注选车、用车、通勤、家庭出行和驾驶体验的人群。",
    painPoint: "用户不缺车型信息，缺适合自己预算和场景的选择依据。",
    positioningHint: "定位成能把购车/用车判断讲清楚的人，而不是泛泛聊车的人。",
    analysisHint: "先讲适合谁、预算段、核心差异和长期使用成本，再讲配置。",
    trustAsset: "试驾体验、费用拆解、场景对比、长期用车记录。",
    primaryConversion: "品牌合作、咨询、团购线索、服务预约。",
    commercialFocus: "先建立信任和判断力，再承接品牌合作和高客单线索。",
    offerExamples: ["选车咨询", "试驾线索", "品牌合作", "养车服务"],
    keywords: ["汽车", "买车", "选车", "试驾", "新能源", "续航", "驾驶", "通勤", "油耗"],
  },
  {
    id: "rural-agriculture",
    name: "三农农业",
    audience: "关注农业生产、农村创业、乡村生活和土特产消费的人群。",
    painPoint: "用户最在意真实和收益，不买泛情怀，要看产地、品质和经营逻辑。",
    positioningHint: "定位成能把产地、产品和经营价值讲清楚的人，而不是单纯记录乡村生活的人。",
    analysisHint: "先讲产地差异、种养过程、品质判断和收益逻辑，再讲故事。",
    trustAsset: "实地画面、产地过程、对比、经营账本、真实反馈。",
    primaryConversion: "农产品销售、助农带货、品牌合作、线索咨询。",
    commercialFocus: "先用真实产地和价值建立信任，再承接商品与合作。",
    offerExamples: ["助农带货", "产地直播", "品牌合作", "农产品清单"],
    keywords: ["三农", "农业", "农村", "养殖", "种植", "农产品", "助农", "乡村", "果园"],
  },
  {
    id: "pet-economy",
    name: "宠物养护",
    audience: "关注养宠、宠物健康、训练和宠物消费的人群。",
    painPoint: "用户不缺萌宠内容，缺养护判断、训练方法和用品决策。",
    positioningHint: "定位成能解决养宠问题的人，而不是只发可爱瞬间的人。",
    analysisHint: "先讲宠物状态、问题、训练或护理方法，再给用品与注意点。",
    trustAsset: "前后变化、用品对比、喂养/训练记录、兽医建议。",
    primaryConversion: "商品转化、咨询、课程、品牌合作。",
    commercialFocus: "先建立专业信任，再承接用品、服务与品牌合作。",
    offerExamples: ["宠物用品清单", "训练咨询", "课程", "品牌合作"],
    keywords: ["宠物", "猫", "狗", "养宠", "训犬", "喂养", "猫粮", "狗粮", "兽医"],
  },
  {
    id: "travel-local",
    name: "文旅探店",
    audience: "关注旅行决策、本地生活、探店和体验消费的人群。",
    painPoint: "用户不缺好看画面，缺值不值得去、怎么安排和避坑判断。",
    positioningHint: "定位成降低决策成本的人，而不是只做打卡记录的人。",
    analysisHint: "先讲适合谁、预算、体验亮点和避坑点，再讲过程。",
    trustAsset: "路线清单、价格信息、真实体验、避坑建议。",
    primaryConversion: "到店、团购、预订、品牌合作。",
    commercialFocus: "优先把高意向人群导向预订和到店，再做品牌合作放大。",
    offerExamples: ["路线攻略", "团购链接", "预订入口", "品牌合作"],
    keywords: ["旅行", "酒店", "民宿", "景点", "探店", "打卡", "攻略", "本地生活", "餐厅"],
  },
  {
    id: "legal-tax",
    name: "法律财税",
    audience: "关注合同、税务、合规、企业风险和个人权益保护的人群。",
    painPoint: "用户最怕专业词堆砌，真正要的是风险判断和可执行动作。",
    positioningHint: "定位成能把风险说成人话的人，而不是只讲法规条文的人。",
    analysisHint: "先讲风险场景、代价和应对动作，再补专业依据。",
    trustAsset: "案例拆解、风险提示、模板、清单、合规流程。",
    primaryConversion: "咨询、模板、顾问服务、会员。",
    commercialFocus: "先用高频风险场景建立信任，再承接专业服务。",
    offerExamples: ["法律咨询", "财税模板", "顾问服务", "会员订阅"],
    keywords: ["法律", "律师", "合同", "税务", "财税", "合规", "仲裁", "风险", "发票"],
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
