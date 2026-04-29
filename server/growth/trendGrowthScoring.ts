/**
 * 4 大平台爆款「增长潜力」评分与筛选工具
 *
 * 用户痛点（2026-04-29）：
 * - 旧排序公式 = `hotValue + views/1000 + likes/100`，本质是绝对值排行
 * - 两年前的老作品点赞天然多（那时创作者少），混进来是历史污染
 * - 企业号花钱投流（DOU+ / 薯条 / 星图）→ 数据不真实
 * - 行业归类经常跑出"待判定行业"，让大模型分析时分类失败
 *
 * 新规则：
 *   1. 严格 18 天窗口（按 publishedAt；缺失视为不可信）
 *   2. 排除企业号 / 媒体号 / 政务号（accountType + 启发式正则双保险）
 *   3. growthScore = 互动密度 × 时效衰减 × 同账号突然爆发倍率
 *      ⚠️ 故意降权 likes（容易被刷 / 历史失真），加重评论 + 转发权重
 *   4. 行业强制归类：industryLabels 为空 / 含"待判定/待定/未分类/通用" → 用 title+tags 启发式归类
 *   5. 标记 isBreakout（同账号互动 ≥ 该作者历史均值 2x）
 *
 * 输出：每条 entry 多带 growthScore / category / isBreakout / ageDays / commentDensity，
 *      让前端显示 +N% 增长率徽章 + 突然爆发标记，让 LLM 分析时能直接拿到分类。
 */

import type { TrendItem } from "./trendCollector";

const WINDOW_DAYS = 18;
const BREAKOUT_RATIO = 2; // 当前互动 ≥ 该作者历史均值 2 倍 → 标记 isBreakout

/** 企业号 / 媒体号 / 政务号识别正则（投流嫌疑大，必须排除）
 *  — 经验值：覆盖大多数中文平台的官方 / 品牌 / 旗舰店 / 媒体号命名
 *  — 同时 accountType 字段已显式标 enterprise/media/government 的也直接排除
 */
const ENTERPRISE_NAME_PATTERNS = [
  /官方(账号|旗舰店|号)?$/i,
  /旗舰店/,
  /品牌/i,
  /集团/,
  /(股份|有限)公司/,
  /上市/,
  /(传媒|文化|科技|网络|信息|教育)有限/,
  /(培训|课程|讲堂|学院|EDU)/i,
  /(医院|医疗|医美|诊所|连锁)/,
  /(网|报|社|台|TV|TV.+)$/i, // 中央网/新华社/央视新闻/凤凰网...
  /(党委|政府|政务|公安|消防|交警|应急|党媒)/,
  /^@?(CCTV|新华|人民|央视|凤凰|环球|国资委)/i,
  /(蓝V|企业号|品牌方|商家|商户|店铺|商城)/,
  /(集团|总裁|CEO|董事长|创始人).*?(俱乐部|联盟|圈)/,
];

function isEnterpriseAccount(item: TrendItem): { excluded: boolean; reason?: string } {
  // 1. 显式字段
  if (item.accountType && (item.accountType === "enterprise" || item.accountType === "media" || item.accountType === "government")) {
    return { excluded: true, reason: `accountType=${item.accountType}` };
  }
  // 2. 名字启发式
  const author = String(item.author || "").trim();
  if (!author) return { excluded: false };
  for (const pat of ENTERPRISE_NAME_PATTERNS) {
    if (pat.test(author)) {
      return { excluded: true, reason: `name_match:${pat}` };
    }
  }
  return { excluded: false };
}

/** 行业归类启发式词典（覆盖：用户提的「健身/职场/教育/健康/美妆/知识/商业/科技/剧情/娱乐/运动」）
 *  关键：禁止"待判定/待定/未分类/通用"出现在最终归类里
 */
const CATEGORY_RULES: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "健身塑形",         patterns: [/(健身|塑形|减脂|增肌|瑜伽|普拉提|体态|拉伸|马甲线|健美|腹肌|训练计划)/] },
  { label: "职场与个人成长",   patterns: [/(职场|升职|加薪|跳槽|面试|简历|求职|副业|时间管理|效率|社畜|打工|内卷|裸辞|个人成长|自我提升)/] },
  { label: "知识付费 · 教育",  patterns: [/(课程|学习|考试|考研|考公|留学|学英语|教程|笔记|拆解|方法论|思维)/] },
  { label: "美妆 · 护肤",      patterns: [/(美妆|护肤|彩妆|口红|面膜|底妆|防晒|抗老|抗衰|敏感肌|油皮|干皮|妆容|眼影|眉毛)/] },
  { label: "母婴 · 育儿",      patterns: [/(母婴|育儿|宝宝|奶粉|纸尿裤|辅食|早教|孕期|备孕|月子|学步|幼儿园)/] },
  { label: "健康 · 医美",      patterns: [/(医美|医疗|抗衰|养生|中医|失眠|焦虑|抑郁|高血压|糖尿病|甲状腺|皮肤管理|轻医美)/] },
  { label: "时尚 · 穿搭",      patterns: [/(穿搭|OOTD|搭配|衣品|时尚|奢牌|包包|大衣|风衣|阔腿裤|衬衫|牛仔|高跟鞋)/] },
  { label: "美食 · 探店",      patterns: [/(美食|探店|食谱|做饭|烘焙|甜品|餐厅|火锅|川菜|粤菜|日料|早餐|减脂餐|料理)/] },
  { label: "旅游 · 出行",      patterns: [/(旅游|景点|攻略|出游|度假|酒店|民宿|机票|签证|跨境|出差|自驾|徒步|露营)/] },
  { label: "家居 · 生活方式",  patterns: [/(家居|装修|软装|家具|宜家|清洁|收纳|断舍离|家电|厨房|卫浴|轻奢风|侘寂)/] },
  { label: "数码 · 科技",      patterns: [/(数码|科技|手机|电脑|笔电|耳机|相机|无人机|AI|ChatGPT|Gemini|大模型|苹果|华为|小米)/] },
  { label: "汽车 · 出行",      patterns: [/(汽车|新能源|特斯拉|比亚迪|理想|蔚来|自驾|车评|提车|改装|新车)/] },
  { label: "宠物 · 萌宠",      patterns: [/(宠物|猫咪|狗狗|柯基|金毛|博美|猫粮|狗粮|铲屎|养宠)/] },
  { label: "情感 · 婚恋",      patterns: [/(情感|恋爱|分手|离婚|婚姻|相亲|脱单|约会|挽回|心理学|两性)/] },
  { label: "搞笑 · 娱乐",      patterns: [/(搞笑|沙雕|段子|爆笑|整活|尴尬|名场面|短剧|reaction|玩梗)/] },
  { label: "影视 · 剧情解说",  patterns: [/(影视|短剧|剧情|解说|追剧|电视剧|电影|预告|影评|综艺)/] },
  { label: "游戏 · 二次元",    patterns: [/(游戏|手游|主机|switch|原神|王者|吃鸡|二次元|动漫|COS|配音)/] },
  { label: "商业 · 创业",      patterns: [/(创业|商业|融资|商业模式|品牌|营销|增长|私域|引流|获客|MCN|主理人|个体户|做生意|开店)/] },
  { label: "财经 · 投资",      patterns: [/(理财|基金|股票|A股|港股|美股|存款|消费贷|信用卡|保险|经济|GDP|通胀|利率)/] },
  { label: "运动 · 户外",      patterns: [/(运动|跑步|马拉松|骑行|游泳|羽毛球|网球|篮球|滑雪|登山|潜水|冲浪)/] },
  { label: "音乐 · 文艺",      patterns: [/(音乐|乐器|钢琴|吉他|架子鼓|演唱|翻唱|创作|乐队|歌手|演唱会)/] },
];

const FALLBACK_CATEGORY = "泛生活方式";

/** 强制归类：industryLabels 缺失或含"待判定" → 启发式补一个 */
function forceCategorize(item: TrendItem): string {
  const existing = (item.industryLabels || []).find(
    (label) => label && !/待(判定|定)|未分类|通用|其他/.test(label),
  );
  if (existing) return existing;

  const haystack = `${item.title || ""} ${(item.tags || []).join(" ")} ${item.bucket || ""}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return rule.label;
    }
  }
  return FALLBACK_CATEGORY;
}

function getAgeDays(publishedAt: string | undefined): number | null {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / (24 * 60 * 60 * 1000));
}

/** 同账号其他作品互动均值（用于"突然爆发"识别） */
function buildAuthorAvgEngagement(items: TrendItem[]): Map<string, number> {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const it of items) {
    const author = String(it.author || "").trim();
    if (!author) continue;
    const eng = (it.likes || 0) * 0.3 + (it.comments || 0) * 4 + (it.shares || 0) * 6;
    const cur = buckets.get(author) || { sum: 0, count: 0 };
    cur.sum += eng;
    cur.count += 1;
    buckets.set(author, cur);
  }
  const result = new Map<string, number>();
  buckets.forEach(({ sum, count }, author) => {
    if (count >= 2) result.set(author, sum / count); // ≥ 2 条才算"账号均值"
  });
  return result;
}

export interface ScoredTrendItem {
  item: TrendItem;
  /** 增长潜力分（不可比绝对值，仅同批次内排序） */
  growthScore: number;
  /** 增长潜力百分位（0~100，相对当前批次） */
  growthPercentile: number;
  /** 行业大类（强制非空） */
  category: string;
  /** 同账号纵向突然爆发（互动 ≥ 历史均值 2x） */
  isBreakout: boolean;
  /** 评论密度（comments/views，反映"是不是大家都在评论") */
  commentDensity: number;
  /** 距今天数（用于 UI "发布 N 天前"） */
  ageDays: number | null;
  /** debug：被过滤掉的原因（仅在 debug 模式返回） */
  filterReason?: string;
}

export interface SelectionDebug {
  total: number;
  excluded: {
    noPublishedAt: number;
    outOfWindow: number;
    enterprise: number;
  };
  kept: number;
  topCategoryDistribution: Record<string, number>;
}

/**
 * 按"增长潜力"挑出每个平台的 topN 条爆款
 *
 * @param items   原始 TrendItem 列表（来自 trendStore.collections[platform].items）
 * @param topN    每平台保留几条
 * @param windowDays 窗口天数（默认 18，用户要求）
 */
export function selectByGrowthPotential(
  items: TrendItem[],
  opts?: { topN?: number; windowDays?: number },
): { selected: ScoredTrendItem[]; debug: SelectionDebug } {
  const topN = opts?.topN ?? 5;
  const windowDays = opts?.windowDays ?? WINDOW_DAYS;

  const debug: SelectionDebug = {
    total: items.length,
    excluded: { noPublishedAt: 0, outOfWindow: 0, enterprise: 0 },
    kept: 0,
    topCategoryDistribution: {},
  };

  // ── 1. 硬过滤：18 天窗口 + 排除企业号 ───────────────────────────────────
  const survivors: TrendItem[] = [];
  for (const it of items) {
    const ageDays = getAgeDays(it.publishedAt);
    if (ageDays === null) {
      // ⚠️ 严格模式：没有发布时间的作品不可信，直接排除（避免 2 年前老作品混入）
      debug.excluded.noPublishedAt += 1;
      continue;
    }
    if (ageDays > windowDays) {
      debug.excluded.outOfWindow += 1;
      continue;
    }
    const ent = isEnterpriseAccount(it);
    if (ent.excluded) {
      debug.excluded.enterprise += 1;
      continue;
    }
    survivors.push(it);
  }

  // ── 2. 同账号均值（用于 breakout 检测） ────────────────────────────────
  const authorAvg = buildAuthorAvgEngagement(survivors);

  // ── 3. 算 growthScore ────────────────────────────────────────────────
  const scored: ScoredTrendItem[] = survivors.map((it) => {
    const ageDays = getAgeDays(it.publishedAt) ?? windowDays;
    const views = Number(it.views || 0);
    const comments = Number(it.comments || 0);
    const shares = Number(it.shares || 0);
    const likes = Number(it.likes || 0);

    // 互动密度：评论 + 转发占主导，likes 仅作弱信号
    const engagement = comments * 4 + shares * 6 + likes * 0.3;

    // 时效衰减：越新越值钱（18 天内线性衰减 1.0 → 0.4）
    const freshness = 1 - (ageDays / windowDays) * 0.6;

    // 评论密度（反映"讨论度"，不是"曝光度"）
    const commentDensity = views > 0 ? comments / views : (comments > 0 ? 0.001 : 0);

    // 同账号纵向爆发倍率（如果该作者均值已知，且当前互动 ≥ 均值）
    const author = String(it.author || "").trim();
    const avg = author ? authorAvg.get(author) : undefined;
    const breakoutRatio = avg && avg > 0 ? engagement / avg : 1;
    const isBreakout = breakoutRatio >= BREAKOUT_RATIO;
    const breakoutBoost = isBreakout ? Math.min(breakoutRatio, 5) : 1; // 最多 5x

    const growthScore = engagement * freshness * breakoutBoost + commentDensity * 1_000_000;

    return {
      item: it,
      growthScore,
      growthPercentile: 0, // 后面统一算
      category: forceCategorize(it),
      isBreakout,
      commentDensity,
      ageDays: Number(ageDays.toFixed(1)),
    };
  });

  // ── 4. 按 growthScore 降序，取 topN，再算百分位 ──────────────────────
  scored.sort((a, b) => b.growthScore - a.growthScore);
  const selected = scored.slice(0, topN);

  if (selected.length > 0) {
    const max = selected[0].growthScore || 1;
    const min = selected[selected.length - 1].growthScore;
    const range = max - min || 1;
    selected.forEach((s) => {
      // 百分位：转成"+N%"展示用，最高 +200% 上限
      const pct = ((s.growthScore - min) / range) * 200 + 30;
      s.growthPercentile = Math.round(pct);
    });
  }

  debug.kept = selected.length;
  for (const s of selected) {
    debug.topCategoryDistribution[s.category] = (debug.topCategoryDistribution[s.category] || 0) + 1;
  }

  return { selected, debug };
}
