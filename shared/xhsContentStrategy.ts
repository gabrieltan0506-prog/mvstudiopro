/** 小红书创作方法：只编译创作约束与可追溯样本，不发起模型调用。 */
export const XHS_CONTENT_SKILL_ID = "xhs-content-growth";
export const XHS_CONTENT_VERSION = "2026-10-14.1";
/** 新专项固定合同；旧工作流保持原模型与用户选项。 */
export const XHS_TEXT_MODEL = "z-ai/glm-5.3-flashx";
export const XHS_TEXT_HOPS = [
  { modelName: XHS_TEXT_MODEL, gateway: "auto", label: "GLM 5.3 FlashX · OpenRouter" },
  { modelName: "glm-5.3-flashx", gateway: "evolink_flash_only", label: "GLM 5.3 FlashX · EvoLink" },
] as const;
export function xhsTopicCount(raw: unknown): 2 | 3 { return Number(raw) === 2 ? 2 : 3; }
/** 复用知识卡像素入口：仅官方与EvoLink，同模型，不竞速弃单。 */
export const XHS_IMAGE_POLICY = {
  openaiImageVariant: "sunburst", requireImageVariant: true, exactSunburst: true,
  providerOverride: "openai", imageLane: "asset",
} as const;

export const XHS_CONTENT_GUIDANCE = `【小红书创作与转化】
先确认人群、具体场景、真实经验/素材、可提供的价值、本轮目标（获客/关注/成交）和产品服务。信息不足就写待补，不虚构身份、案例、收入或效果。
选题：用人群×场景×一个问题×一个可执行结果，结合相关Growth样本提出候选。拆解话题与结构，不复制原文；不相关热点放弃。每条说明受众、问题、差异化、证据与承接动作。
Growth是采集样本，非平台全量、非本人账号数据。严格说明时间字段/窗口/样本量；无样本时只给待验证创意。点赞、评论、收藏与热度分别说明，不混算CTR、完播率、涨粉率、成交率；创意评分不是爆款概率，关键词不等于已证低竞争。
标题与封面分工：标题说清主题+人群/场景长尾词，封面给一个值得点开的理由。提供一个主选和三个不同切口备选；数字必须可查证，不用全网最/保证涨粉/99%都不知道或虚构稀缺。正文兑现标题承诺。
封面：明确人物/物件、生活场景、可见动作或对比、主副标题、构图、字体对比、留白与系列一致性。比例服从当前图片入口实际可用画布，不把平台通用比例写成已支持能力；本产品独立图文页为9:16，明确要求其他比例时先核实际入口能力与限制；按内容选择人物场景或真实授权的操作结果、清单示例、同条件测评证据，避免整页小字、空背景和堆装饰；缺证据只列待补素材或明确标示例，不造后台或业绩截图。前后对比必须同条件且真实。其余图沿同一角色/风格，每页一个问题或动作。
图文：按问题解决、教程、测评、清单、科普或真实故事选结构；封面→具体痛点/场景→有依据的步骤/实例→可保存清单→一个自然承接动作。页数服从用户要求与信息量，不能为了凑页重复。正文可独立阅读，写明资料来源与适用边界。
视频：开头直接进入问题或现场→按时间线/并列步骤/前后对比展开→结尾收口。逐段给时间、画面动作、口播、字幕与音效需要；时长服从用户输入，口播量与时间一致。故事可用开端—阻碍—转机—行动变化—启示，不能编造亲历或客户评价。
转化：每篇只选一个主动作。涨粉给下一期明确收益；获客用具体问题引导站内咨询；成交讲清适用人群、真实差异、价格依据、交付与售后。允许用户不购买，避免强迫评论/关注才能获得正文答案，不藏联系方式绕规则，不主动群发或发布。
复盘：发布前记录假设与版本；发布后同一24小时/7天窗口对比，先区分曝光、打开、有效咨询、订单与交付问题，按已有证据仅改对应层的一项变量。只有同来源真实曝光和点击才能算CTR；关注/线索/订单需真实归因与分母，缺失就标未采集。没有曝光分母不区分没人看到与看到不打开；相关变化不证明因果，订单/咨询比不冒称客户成交率。下一轮只改证据指向的问题，不承诺增长结果。
来源：用户提供Day2第3–19、21–22页；运营策略与Day1定位/变现部分；账号诊断SWOT与实验复盘；运营知识地图的用户价值与内容闭环。课程中的算法权重、门槛、固定时段、费用、收益案例不是当前平台事实。`;

export type XhsCreativeBrief = {
  audience: string; scene: string; problem: string; proof: string;
  offer: string; goal: "acquire" | "follow" | "convert";
  format: "图文笔记" | "视频文案"; constraints?: string;
};

export function compileXhsCreativeBrief(brief: XhsCreativeBrief): string {
  const fields = [brief.audience, brief.scene, brief.problem, brief.proof];
  if (fields.some(v => !String(v || "").trim())) throw new Error("请填写目标人群、具体场景、要解决的问题和真实素材");
  const goal = { acquire: "获客：用一个具体问题承接站内咨询", follow: "涨粉：说明下一期能继续解决什么", convert: "成交：讲清适用人群、交付与售后" }[brief.goal];
  if (!goal) throw new Error("请选择创作目标");
  if (brief.goal === "convert" && !String(brief.offer || "").trim()) throw new Error("成交目标需要填写真实产品或服务");
  const text = ["【小红书创作需求】", `人群：${brief.audience}`, `场景：${brief.scene}`, `问题：${brief.problem}`, `真实素材/经历：${brief.proof}`, `产品/服务：${brief.offer || "尚未确定；不编造商品或成交承诺"}`, `目标：${goal}`, `形式：${brief.format}`, `要求：${brief.constraints || "先选题，选中后再写正文与封面；每篇一个主动作"}`].join("\n");
  if (text.length > 3000) throw new Error("创作需求过长，请精简至3000字内");
  return text;
}

export type XhsGrowthSample = {
  id: string; title: string; url?: string; date: string;
  dateKind: "publishedAt" | "observedAt" | "collectedAt" | "createdAt";
  likes?: number; comments?: number; tags: string[];
  relevance?: { matchedTerms: string[]; score: number };
};
export type XhsGrowthEvidence = {
  platform?: "xiaohongshu" | "douyin";
  version: string; capturedAt: string; windowStart: string; windowEnd: string;
  sourceCount: number; eligibleCount: number; excludedUnknownDate: number;
  excludedOutsideWindow: number; duplicateCount: number; selectedCount: number;
  samples: XhsGrowthSample[]; note: string;
};

function metric(raw: unknown): number | undefined {
  if (raw == null || (typeof raw !== "number" && typeof raw !== "string") || String(raw).trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 严格窗口；只有明确可解析日期才入选。不把缺样本时退回全量称为近期。 */
export function buildXhsGrowthEvidence(rows: Array<Record<string, unknown>>, windowDays = 30, now = Date.now(), context = "", platform: "xiaohongshu" | "douyin" = "xiaohongshu"): XhsGrowthEvidence {
  const days = Number.isFinite(windowDays) ? Math.max(1, Math.min(365, windowDays)) : 30;
  const cutoff = now - days * 86400000;
  let excludedUnknownDate = 0, excludedOutsideWindow = 0, duplicateCount = 0;
  const seen = new Set<string>();
  const samples: XhsGrowthSample[] = [];
  for (const row of rows) {
    const title = String(row.title || "").trim().slice(0, 2000);
    if (!title) continue;
    const dateKind = (["publishedAt", "observedAt", "collectedAt", "createdAt"] as const).find(key => row[key] != null && row[key] !== "");
    const rawDate = dateKind ? row[dateKind] : undefined;
    const dateText = String(rawDate ?? "").trim();
    const numericDate = typeof rawDate === "number" ? rawDate : /^\d{10}(?:\d{3})?$/.test(dateText) ? Number(dateText) : undefined;
    const stamp = numericDate !== undefined ? (numericDate < 1e12 ? numericDate * 1000 : numericDate) : /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:?\d{2}))?$/.test(dateText) ? Date.parse(dateText) : NaN;
    if (!dateKind || !Number.isFinite(stamp)) { excludedUnknownDate++; continue; }
    if (stamp < cutoff || stamp > now) { excludedOutsideWindow++; continue; }
    const rawUrl = String(row.url || row.sourceUrl || row.noteUrl || "");
    let url: string | undefined;
    try { const parsed = new URL(rawUrl); if (rawUrl.length <= 2000 && ["http:", "https:"].includes(parsed.protocol)) url = rawUrl; } catch { /* 无效来源链接不显示为可点击出处。 */ }
    const id = String(row.id || row.noteId || url || title).slice(0, 2000);
    if (seen.has(id)) { duplicateCount++; continue; }
    seen.add(id);
    samples.push({ id, title, url, date: new Date(stamp).toISOString(), dateKind, likes: metric(row.likes), comments: metric(row.comments), tags: Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean).slice(0, 100).map(tag => tag.slice(0, 200)) : [] });
  }
  // 先匹配创作场景，再看采集时互动；不是平台热度公式，也不是效果预测。
  const match = createXhsRelevanceMatcher(context, samples);
  for (const sample of samples) sample.relevance = match(sample);
  samples.sort((a, b) => (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0) || (b.likes ?? -1) - (a.likes ?? -1) || a.id.localeCompare(b.id));
  // 明示摘要容量与原始样本数，不称为全量统计或概率。
  const relevant = context.trim() ? samples.filter(sample => (sample.relevance?.score ?? 0) > 0) : samples;
  const selected: XhsGrowthSample[] = [];
  // 明确并列主题各保留一个有来源的入口，不能由泛主题的高分样本挤走第二身份。
  const { focus } = xhsRelevanceQuery(context);
  for (const term of Array.from(focus)) {
    const sample = relevant.find(row => row.relevance?.matchedTerms.includes(term));
    if (sample && !selected.some(row => row.id === sample.id) && selected.length < 12) selected.push(sample);
  }
  for (const sample of relevant) if (selected.length < 12 && !selected.some(row => row.id === sample.id)) selected.push(sample);
  return { platform, version: XHS_CONTENT_VERSION, capturedAt: new Date(now).toISOString(), windowStart: new Date(cutoff).toISOString(), windowEnd: new Date(now).toISOString(), sourceCount: rows.length, eligibleCount: samples.length, excludedUnknownDate, excludedOutsideWindow, duplicateCount, selectedCount: selected.length, samples: selected, note: `Growth${platform === "douyin" ? "抖音" : "小红书"}采集样本；窗口内${samples.length}条，摘要选取${selected.length}条。发布时间优先，采集时间不能当发布时间；赞评是采集时累计值，不能推算曝光、点击、涨粉或成交。${selected.length ? "仅借题材与结构，非本人账号表现。" : samples.length ? "窗口内没有命中当前人群场景的样本，本轮创意须另行验证。" : "本窗口无可用样本，本轮创意须另行验证。"}` };
}

// 中文按词切分，避免把“同一、身体、希望”等相邻二字拼片当作主题。
const XHS_MATCH_STOP = new Set("小红书 抖音 内容 创作 目标 人群 场景 问题 真实 素材 经历 产品 服务 要求 形式 图文 视频 文案 本轮 通过 可以 一个 我们 自己 提供 分享 方法 背景 个人 特点 读者 希望 喜欢 愿意 不希望 不想 不要 不是 而是 不能 不用 不会 不愿 如何 怎么 怎样 什么 哪些 为什么 时候 时候的人 人的 大家 他们 她们 别人 有人 平时 现在 过去 后续 开始 进行 围绕 同时 相关 参考 样本 方面 普通 日常 生活 工作 时间 觉得 知道 经常 比较 需要 可能 只有 没有 还有 以及 这些 那些 这种 这样 一点 一起 每天 每周 休息 看见 看到 看过 接触 本人 关注 收藏 结果 具体 过程 经验 习惯 长期 坚持 清单 不同 重点 方式 事情 选择 表达 说话 节奏 温和 直接 喜欢 清楚 明确 寻找 查找 尽量 避免 适合 适用 边界 不断 成为 带来 更好 只有 最后 不再 时候 不一定 身体 感受 状态 不会 包装 虚构 编造 夸大 承诺 专业 影响 分享者 碎片 讲解 教学 老师 简单 相关 推荐 全部 同一 同时 个人 真实 可执行 读者 困惑 结论 清楚 单一 职业 实际 使用 新手 情况 看懂 一名 一段 记录 找回 后续 寻找 参考 内容 严格 普通人 目前 变成 不为 可以 了解 学会 人的 场景".split(" "));
type RelevanceSample = { title: string; tags?: string[] };
function contextTerms(context: string): string[] {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const parts = Array.from(segmenter.segment(context.toLowerCase()));
  const words = parts.filter(part => part.isWordLike).map(part => part.segment);
  // ICU会把新词拆为单字（如二/胎、宝/妈、秋/招）；仅在相邻单字串内补词。
  let singles = "";
  const flush = () => { for (let i = 0; i + 1 < singles.length; i++) words.push(singles.slice(i, i + 2)); singles = ""; };
  for (const part of parts) {
    if (part.isWordLike && /^[\u3400-\u9fff]$/.test(part.segment) && !"的了与和在是我你他她它把将就也又而请能要很较须后到去来有过但为以所可不".includes(part.segment)) singles += part.segment;
    else flush();
  }
  flush();
  return Array.from(new Set(words.filter(term => term.length >= 2 && term.length <= 100 && !XHS_MATCH_STOP.has(term) && !/^\d+$/.test(term))));
}
export function xhsRelevanceQuery(context: string) {
  // 排除用户明确拒绝的方向；保留完整context交给创作模型，此处仅用于检索。
  const positive = context.split(/[。！!？?；;\n]/).map(sentence => sentence.replace(/(?:不需要|不必|不再|不希望|不想|不愿|不要|避免|不作|不承诺|不编造|不制造|不夸大|不要求|不是|不喜欢|不追求|不擅长)[^，,]*([，,]|$)/g, " ")).join("。");
  const terms = contextTerms(positive);
  const focusText = Array.from(positive.matchAll(/(?:本轮要求|要求|问题|主题|方向)[：:]([^。\n]*)/g)).map(match => match[1]).join(" ");
  const focus = new Set(contextTerms(focusText));
  return { terms, focus };
}
/** 仅排除明确标作娱乐剧情的样本，用户要写剧情时照常保留。 */
export function isUnrequestedFiction(context: string, source: string) {
  return !/短剧|漫剧|剧情|小说|影视|甜宠|爽剧/.test(context) && /短剧|漫剧|甜宠|爽剧|霸道总裁|豪门总裁|全集解说|男主|女主|一人分饰多角|演剧场/.test(source);
}
/** 词匹配用于找参考，不代表语义理解或创意效果。 */
export function createXhsRelevanceMatcher(context: string, corpus: RelevanceSample[] = []) {
  const { terms, focus } = xhsRelevanceQuery(context);
  const sources = corpus.map(sample => [sample.title, ...(sample.tags || [])].join(" ").toLowerCase());
  const weights = new Map(terms.map(term => {
    const hits = sources.reduce((count, source) => count + Number(source.includes(term)), 0);
    const rarity = corpus.length ? Math.log(1 + (corpus.length - hits + 0.5) / (hits + 0.5)) : 1;
    return [term, rarity * (focus.has(term) ? 5 : 1)] as const;
  }));
  return (sample: RelevanceSample): { matchedTerms: string[]; score: number } => {
    const source = [sample.title, ...(sample.tags || [])].join(" ").toLowerCase();
    if (isUnrequestedFiction(context, source)) return { matchedTerms: [], score: 0 };
    const matchedTerms = terms.filter(term => source.includes(term));
    // 明确提出本轮主题时，个人气质或职业描述不能独自把无关热点带入参考。
    if (focus.size && !matchedTerms.some(term => focus.has(term))) return { matchedTerms: [], score: 0 };
    const tags = (sample.tags || []).join(" ").toLowerCase();
    const score = Math.sqrt(matchedTerms.length) * matchedTerms.reduce((sum, term) => sum + (weights.get(term) || 1) * (tags.includes(term) ? 1.5 : 1), 0)
      / (0.6 + 0.4 * Math.max(1, source.length / 120));
    return { matchedTerms, score: Math.round(score * 100) };
  };
}
export function scoreXhsSampleRelevance(context: string, sample: RelevanceSample) {
  return createXhsRelevanceMatcher(context)(sample);
}

export type XhsOwnMetrics = {
  source: string; noteId: string; windowHours: 24 | 168;
  impressions?: number; opens?: number; likes?: number; saves?: number; comments?: number;
  follows?: number; leads?: number; orders?: number; revenue?: number;
};
export type XhsMetricResult = {
  key: string; label: string; value: number | null; numerator: number | null;
  denominator: number | null; formula: string; missing: string[];
};
/** 本人后台同篇同窗数据才计算；Growth他人样本不得填进此函数冒充归因。 */
export function calculateXhsOwnMetrics(input: XhsOwnMetrics): XhsMetricResult[] {
  if (!input.source?.trim() || !input.noteId?.trim()) throw new Error("请注明本人后台来源与笔记ID");
  if (![24, 168].includes(input.windowHours)) throw new Error("请选同一24小时或7天统计窗口");
  const defs = [
    ["ctr", "打开率", "opens", "impressions", "打开次数 / 曝光次数"],
    ["saveRate", "收藏率", "saves", "opens", "收藏次数 / 打开次数"],
    ["followRate", "关注转化率", "follows", "opens", "本篇归因新增关注 / 打开次数"],
    ["leadRate", "线索转化率", "leads", "opens", "本篇归因有效咨询 / 打开次数"],
    ["orderRate", "订单/咨询比", "orders", "leads", "本篇归因成交订单数 / 有效咨询次数（不是客户成交率）"],
  ] as const;
  for (const key of ["impressions", "opens", "likes", "saves", "comments", "follows", "leads", "orders", "revenue"] as const) {
    const v = input[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new Error(`${key}须为非负数字，未采集请留空`);
  }
  return defs.map(([key, label, num, den, formula]) => {
    const numerator = input[num] ?? null, denominator = input[den] ?? null;
    const missing = [numerator === null ? num : "", denominator === null ? den : "", denominator === 0 ? "分母为0" : ""].filter(Boolean);
    return { key, label, value: missing.length ? null : numerator! / denominator!, numerator, denominator, formula, missing };
  });
}

export function compareXhsOwnMetrics(before: XhsOwnMetrics, after: XhsOwnMetrics): { metric: string; before: number | null; after: number | null; percentagePointChange: number | null }[] {
  if (before.windowHours !== after.windowHours || before.source.trim() !== after.source.trim()) throw new Error("对比必须使用相同来源与统计窗口；24小时不能与7天混比");
  const left = calculateXhsOwnMetrics(before), right = calculateXhsOwnMetrics(after);
  return left.map((row, i) => ({ metric: row.label, before: row.value, after: right[i].value, percentagePointChange: row.value === null || right[i].value === null ? null : (right[i].value! - row.value) * 100 }));
}

export function reviewXhsDraft(text: string): Array<{ code: string; message: string }> {
  const findings: Array<{ code: string; message: string }> = [];
  if (!String(text || "").trim()) return [{ code: "empty", message: "稿件为空" }];
  for (const [code, re, message] of [
    ["unsupported_claim", /全网最|保证.{0,6}(涨粉|收益|赚钱|治愈)|99(?:\.9)?%.*不知道|百分百有效/, "核实或改写夸大、绝对化与无依据效果承诺"],
    ["off_platform_evasion", /谐音.{0,8}(微信|加微)|摩斯码|防封.{0,8}(小号|换号)|藏.{0,5}微信/, "删除规避平台规则的联系方式与换号做法"],
    ["false_probability", /爆款概率.{0,8}\d+\s*%|点击率翻倍|流量翻倍/, "创意评分与课程案例不能写成可验证概率或增长保证"],
  ] as const) if (re.test(text)) findings.push({ code, message });
  return findings;
}
