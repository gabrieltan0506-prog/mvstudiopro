import type { TrendItem } from "./trendCollector";
import { normalizeStringList } from "./trendNormalize";

type LabelRule = {
  label: string;
  keywords: string[];
};

const INDUSTRY_RULES: LabelRule[] = [
  { label: "教育培训", keywords: ["学习", "提分", "考试", "中考", "高考", "老师", "课程", "训练营", "题型"] },
  { label: "商业咨询", keywords: ["商业", "咨询", "经营", "增长", "客户", "案例", "创业", "老板", "管理"] },
  { label: "个人成长", keywords: ["成长", "自律", "复盘", "认知", "习惯", "效率", "表达", "行动力"] },
  { label: "家庭关系", keywords: ["家庭", "婚姻", "夫妻", "亲子", "父母", "关系", "沟通", "边界"] },
  { label: "健康管理", keywords: ["健康", "减脂", "康复", "医生", "营养", "睡眠", "慢病", "运动损伤"] },
  { label: "实体线下", keywords: ["门店", "探店", "到店", "本地", "餐饮", "预约", "线下", "服务"] },
  { label: "电商卖家", keywords: ["商品", "带货", "橱窗", "卖家", "店铺", "sku", "客单价", "复购"] },
  { label: "美妆穿搭", keywords: ["美妆", "穿搭", "护肤", "妆", "造型", "时尚", "防晒", "发型"] },
  { label: "财经理财", keywords: ["财经", "理财", "投资", "赚钱", "资产", "现金流", "财务"] },
  { label: "职场求职", keywords: ["职场", "求职", "简历", "面试", "升职", "跳槽", "汇报"] },
  { label: "母婴育儿", keywords: ["育儿", "宝宝", "宝妈", "宝爸", "喂养", "带娃"] },
  { label: "情感心理", keywords: ["情感", "焦虑", "情绪", "关系修复", "心理", "治愈"] },
  { label: "AI工具软件", keywords: ["ai", "工具", "软件", "自动化", "工作流", "提示词", "saas"] },
  { label: "文旅探店", keywords: ["旅行", "酒店", "景点", "攻略", "探店", "打卡", "本地推荐"] },
  { label: "数码科技", keywords: ["数码", "手机", "电脑", "平板", "耳机", "芯片", "开箱", "测评", "配置", "科技"] },
  { label: "家居家装", keywords: ["家居", "装修", "软装", "收纳", "清洁", "户型", "家装", "改造"] },
  { label: "汽车出行", keywords: ["汽车", "买车", "选车", "试驾", "新能源", "续航", "油耗", "驾驶"] },
  { label: "三农农业", keywords: ["三农", "农业", "农村", "种植", "养殖", "果园", "助农", "农产品"] },
  { label: "宠物养护", keywords: ["宠物", "猫", "狗", "训犬", "猫粮", "狗粮", "喂养", "兽医"] },
  { label: "法律财税", keywords: ["法律", "律师", "合同", "税务", "财税", "合规", "发票", "仲裁"] },
  { label: "摄影设计", keywords: ["摄影", "拍照", "修图", "设计", "海报", "视觉", "构图", "布光"] },
];

const AGE_RULES: LabelRule[] = [
  { label: "13-17", keywords: ["初中", "高中", "中学生", "少年", "青少年"] },
  { label: "18-24", keywords: ["大学", "考研", "应届", "校招", "实习", "大学生"] },
  { label: "25-34", keywords: ["职场", "上班", "白领", "升职", "跳槽", "创业"] },
  { label: "35-44", keywords: ["家庭", "家长", "孩子教育", "婚姻", "中年"] },
  { label: "45+", keywords: ["退休", "中老年", "养生", "父母健康"] },
  { label: "新手父母", keywords: ["带娃", "宝妈", "宝爸", "亲子", "育儿"] },
  { label: "成熟家庭", keywords: ["婚姻", "夫妻", "家庭关系", "家长", "父母"] },
  { label: "Z世代", keywords: ["学生党", "宿舍", "二次元", "校园", "追星"] },
  { label: "都市白领", keywords: ["通勤", "白领", "工位", "开会", "下班", "升职"] },
  { label: "创业经营者", keywords: ["老板", "创业", "门店", "管理", "经营"] },
];

const CONTENT_RULES: LabelRule[] = [
  { label: "案例拆解", keywords: ["案例", "拆解", "复盘", "分析"] },
  { label: "教程方法", keywords: ["教程", "方法", "步骤", "清单", "模板", "攻略"] },
  { label: "热点话题", keywords: ["热搜", "热点", "爆火", "热榜", "趋势"] },
  { label: "产品转化", keywords: ["好物", "单品", "推荐", "购买", "橱窗", "下单"] },
  { label: "情绪表达", keywords: ["崩溃", "治愈", "泪目", "震惊", "情绪", "感动"] },
  { label: "生活记录", keywords: ["日常", "vlog", "探店", "记录", "生活", "现场"] },
  { label: "知识观点", keywords: ["观点", "认知", "科普", "知识", "逻辑", "判断"] },
  { label: "对比测评", keywords: ["对比", "测评", "横评", "区别", "怎么选"] },
  { label: "清单推荐", keywords: ["清单", "推荐", "合集", "盘点", "值得买"] },
  { label: "幕后过程", keywords: ["幕后", "拍摄", "制作", "过程", "花絮", "工作流"] },
  { label: "直播切片", keywords: ["直播", "连麦", "切片", "回放"] },
  { label: "故事叙事", keywords: ["故事", "经历", "从前", "后来", "原来"] },
  { label: "口播表达", keywords: ["口播", "直说", "一句话", "结论", "讲清楚"] },
  { label: "开箱试用", keywords: ["开箱", "试用", "上手", "体验", "首发"] },
  { label: "场景演示", keywords: ["场景", "实拍", "演示", "通勤", "到店", "上脸"] },
  { label: "价格决策", keywords: ["价格", "预算", "值不值", "性价比", "客单价"] },
];

function collectText(item: TrendItem) {
  return [
    item.title,
    item.author,
    item.bucket,
    ...normalizeStringList(item.tags),
    ...(item.commentSamples || []).map((sample) => sample.text),
  ].filter(Boolean).join(" ").toLowerCase();
}

function matchLabels(text: string, rules: LabelRule[], fallback: string) {
  const labels = rules
    .filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    .map((rule) => rule.label);
  return labels.length ? labels : [fallback];
}

export function classifyTrendItem(item: TrendItem) {
  const text = collectText(item);
  return {
    industryLabels: matchLabels(text, INDUSTRY_RULES, "待判定行业"),
    ageLabels: matchLabels(text, AGE_RULES, "泛年龄"),
    contentLabels: matchLabels(text, CONTENT_RULES, item.contentType === "topic" ? "热点话题" : "泛内容"),
  };
}

export function countLabels(items: TrendItem[], field: "industryLabels" | "ageLabels" | "contentLabels") {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const label of item[field] || []) {
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  return counts;
}
