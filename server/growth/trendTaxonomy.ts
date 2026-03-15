import type { TrendItem } from "./trendCollector";

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
];

const AGE_RULES: LabelRule[] = [
  { label: "青少年", keywords: ["学生", "校园", "中学", "高中", "初中", "少年"] },
  { label: "大学生", keywords: ["大学", "考研", "实习", "校招", "大学生"] },
  { label: "职场青年", keywords: ["职场", "上班", "简历", "面试", "升职", "跳槽", "白领"] },
  { label: "新手父母", keywords: ["带娃", "宝妈", "宝爸", "亲子", "孩子", "育儿"] },
  { label: "成熟家庭", keywords: ["婚姻", "夫妻", "家庭", "家长", "父母"] },
];

const CONTENT_RULES: LabelRule[] = [
  { label: "案例拆解", keywords: ["案例", "拆解", "复盘", "分析"] },
  { label: "教程方法", keywords: ["教程", "方法", "步骤", "清单", "模板", "攻略"] },
  { label: "热点话题", keywords: ["热搜", "热点", "爆火", "热榜", "趋势"] },
  { label: "产品转化", keywords: ["好物", "单品", "推荐", "购买", "橱窗", "下单"] },
  { label: "情绪表达", keywords: ["崩溃", "治愈", "泪目", "震惊", "情绪", "感动"] },
  { label: "生活记录", keywords: ["日常", "vlog", "探店", "记录", "生活", "现场"] },
  { label: "知识观点", keywords: ["观点", "认知", "科普", "知识", "逻辑", "判断"] },
];

function collectText(item: TrendItem) {
  return [
    item.title,
    item.author,
    item.bucket,
    ...(item.tags || []),
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
