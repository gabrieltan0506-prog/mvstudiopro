import { createHash } from "node:crypto";

/** 每累计 1,000 条，由 DeepSeek V4 Pro 0813 做一次八项结构化整理。 */
export const WEIXIN_CHANNELS_ACCUMULATION_TARGET = 1_000;
export const WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS = 1_000;
/** DeepSeek V4 Pro 0813 千条判别任务的正文预算。 */
export const WEIXIN_CHANNELS_DEEPSEEK_MAX_COMPLETION_TOKENS = 65_536;
/** 8 个千条结果（8,000 条）累计后，Terra High 才做一次最终去噪/UI 清洗。 */
export const WEIXIN_CHANNELS_TERRA_CLEANUP_BATCH_COUNT = 8;
/** 1.05M 上下文为 100K 输出和消息协议留安全余量。 */
export const WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET = 880_000;
export const WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS = 100_000;
/** 仅用于读取旧版状态，不再创建新的 Luna 批次。 */
export const WEIXIN_CHANNELS_LUNA_BATCH_SIZE = 100;
export const WEIXIN_CHANNELS_PROBE_TARGET = 5;
export const WEIXIN_CHANNELS_COMMENT_THRESHOLD = 80;
/**
 * 前置高热信号的业务校准区间。min 是采集硬门槛；referenceHigh 只表示
 * 该指标已进入明显高热段，不是上限，超过它仍然达标。
 */
export const WEIXIN_CHANNELS_HIGH_HEAT_BANDS = {
  likes: { min: 1_000, referenceHigh: 2_000 },
  shares: { min: 500, referenceHigh: 1_000 },
  favorites: { min: 500, referenceHigh: 1_000 },
} as const;
/**
 * 完整五点与真实评论链至少需要 25 秒；35 秒只表示同视频 UI 应停止重复定位并
 * 进入安全收尾，不是服务端拒收上限。已完成素材可超时提交，真正卡死由 180 秒
 * 每窗局部 reset 自检处理。
 */
export const WEIXIN_CHANNELS_CAPTURE_TOLERANCE_MS = 2_000;
export const WEIXIN_CHANNELS_MIN_COMPLETE_CAPTURE_MS = 25_000;
export const WEIXIN_CHANNELS_CAPTURE_SOFT_RETREAT_MS = 35_000;
export const WEIXIN_CHANNELS_CAPTURE_HARD_UI_ADVANCE_MS = 40_000;
/** 兼容既有预算字段；其语义是 35 秒软目标，不是拒收或丢数据上限。 */
export const WEIXIN_CHANNELS_MAX_COMPLETE_CAPTURE_MS = WEIXIN_CHANNELS_CAPTURE_SOFT_RETREAT_MS;

export function weixinChannelsCaptureBudgetMs(videoDurationSec: number) {
  return Math.min(
    WEIXIN_CHANNELS_MAX_COMPLETE_CAPTURE_MS,
    Math.max(
      WEIXIN_CHANNELS_MIN_COMPLETE_CAPTURE_MS,
      Math.round(videoDurationSec * 100) + WEIXIN_CHANNELS_CAPTURE_TOLERANCE_MS,
    ),
  );
}

export type WeixinChannelsCommentSignal =
  | "high_like"
  | "repeated"
  | "controversial"
  | "question";

export type WeixinChannelsCommentSample = {
  author?: string;
  text: string;
  likeCount?: number;
  signals?: WeixinChannelsCommentSignal[];
};

export type WeixinChannelsQualificationInput = {
  query?: string;
  title?: string;
  likes?: number;
  shares?: number;
  favorites?: number;
  comments?: number;
  ocrTexts?: string[];
};

export function isWeixinChannelsQueryRelevant(item: Pick<WeixinChannelsQualificationInput, "query" | "title" | "ocrTexts">) {
  const query = normalizeWeixinChannelsText(item.query);
  const evidence = normalizeWeixinChannelsText([item.title, ...(item.ocrTexts || [])].filter(Boolean).join(" "));
  if (!query || !evidence) return true;
  if (/ai真人短剧/.test(query)) return /(?:ai)?真人短剧|ai短剧/.test(evidence);
  if (/ai漫剧/.test(query)) return /(?:ai)?漫剧|动态漫/.test(evidence);
  if (/ai动漫/.test(query)) return /(?:ai)?动漫|动画/.test(evidence);
  if (/ai视频/.test(query)) return /ai|人工智能/.test(evidence);
  return true;
}

export type WeixinChannelsQualification = {
  qualified: boolean;
  invalid: boolean;
  reason: string;
  requiresComments: boolean;
};

export function containsWeixinChannelsAdvertisement(ocrTexts?: readonly string[]) {
  return (ocrTexts || []).some((text) => /广告|廣告/.test(String(text || "").replace(/\s+/g, "")));
}

/**
 * 视频本身的前置高热门槛。评论只能证明讨论量，不能单独把低互动视频抬成达标。
 */
export function hasWeixinChannelsHighHeatSignals(
  item: Pick<WeixinChannelsQualificationInput, "likes" | "shares" | "favorites">,
) {
  return [
    (Number(item.likes) || 0) >= WEIXIN_CHANNELS_HIGH_HEAT_BANDS.likes.min,
    (Number(item.shares) || 0) >= WEIXIN_CHANNELS_HIGH_HEAT_BANDS.shares.min,
    (Number(item.favorites) || 0) >= WEIXIN_CHANNELS_HIGH_HEAT_BANDS.favorites.min,
  ].filter(Boolean).length >= 2;
}

/** 单条采集的唯一资格真源：纯本地规则，禁止在这里调用模型。 */
export function qualifyWeixinChannelsObservationLocally(
  item: WeixinChannelsQualificationInput,
): WeixinChannelsQualification {
  if (containsWeixinChannelsAdvertisement(item.ocrTexts)) {
    return {
      qualified: false,
      invalid: true,
      reason: "OCR 检出广告，该视频无效且不进入评论或模型链路",
      requiresComments: false,
    };
  }

  if (!isWeixinChannelsQueryRelevant(item)) {
    return {
      qualified: false,
      invalid: false,
      reason: "内容与当前搜索垂类不相关，仅记录扫描结果",
      requiresComments: false,
    };
  }

  if (!hasWeixinChannelsHighHeatSignals(item)) {
    return {
      qualified: false,
      invalid: false,
      reason: "前置高热互动不足，不采样、不打开评论、不上传",
      requiresComments: false,
    };
  }

  const comments = Math.max(0, Number(item.comments) || 0);
  return {
    qualified: true,
    invalid: false,
    reason: comments >= WEIXIN_CHANNELS_COMMENT_THRESHOLD
      ? "前置高热互动达标，评论达到附加采集门槛"
      : "前置高热互动达标，记录数据和精华画面，不打开评论",
    requiresComments: comments >= WEIXIN_CHANNELS_COMMENT_THRESHOLD,
  };
}

export function normalizeWeixinChannelsText(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#＃@＠][^\s#＃@＠]+/g, " ")
    .replace(/[\s~`!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?，。！？、；：“”‘’（）【】《》￥…—]+/g, "")
    .trim();
}

const WEIXIN_CHANNELS_SEARCH_QUERY_REJECT = /(?:直播(?:录制|錄製|回放)?|vlog|日常记录|日常記錄|生活记录|生活記錄|第\s*\d+\s*集|全集|完结|完結|短剧|短劇|爽文|爽剧|爽劇|sku|型号|型號|旗舰店|旗艦店|购买|購買|下单|下單)/i;
const WEIXIN_CHANNELS_GENERIC_SEARCH_QUERY = /^(?:(?:内有|內有|附有|附带|附帶|完整|详细|詳細)?(?:教程|教學|教学|新手|小白|方法|技巧))$/i;

/**
 * 视频号搜索只接受短主题词。完整标题、商品型号和日期句子宁可丢弃，
 * 也不能让本机在无法确认的长输入上反复浪费导航时间。
 */
export function normalizeWeixinChannelsSearchQuery(value: unknown) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/20\d{2}[年./-]\d{1,2}(?:[月./-]\d{1,2}日?)?/g, " ")
    .replace(/\b\d{1,2}[月./-]\d{1,2}日?\b/g, " ")
    .replace(/^[#＃]+|[#＃]+$/g, "")
    .replace(/[【】\[\]（）()《》“”"'，,。.!！?？:：;；|｜/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || WEIXIN_CHANNELS_SEARCH_QUERY_REJECT.test(normalized)) return undefined;
  let compact = normalized.replace(/\s+/g, "");
  // 平台标题偶尔带内部素材/导出后缀，例如 `_760989efc2`。这类 ID 不是用户
  // 主题词；纯数字、纯十六进制及下划线哈希必须在共享真源直接拒绝。
  if (/^_?[0-9a-f]{8,}$/i.test(compact) || /^\d+$/.test(compact)) return undefined;
  // 七天标题常把“新手/小白/教程”层层堆在主题后；视频号搜索需要主题词，
  // 保留具体 AI 垂类并压成“主题+教程”，避免输入整句修饰语。
  compact = compact.replace(
    /^(AI(?:视频|影片|工作流|工具|智能体|副业|营销|变现|漫剧))(?:新手|小白)+(?:入门)?(?:教程|教學|教学)?$/i,
    "$1教程",
  );
  const length = Array.from(compact).length;
  if (length < 2 || length > 12) return undefined;
  if (!/[\u3400-\u9fffA-Za-z]/.test(compact)) return undefined;
  if (WEIXIN_CHANNELS_GENERIC_SEARCH_QUERY.test(compact)) return undefined;
  if (/^(?:ai|人工智能)$/i.test(compact)) return undefined;
  if (/^(?:原来|原來|这次|這次|今天|居然|别再|別再|真的|终于|終於|为什么|為什麼|怎么|怎麼)/i.test(compact)) return undefined;
  if (/(?:这样|這樣|而已|罢了|罷了|了|吗|嗎|呢|吧)$/.test(compact)) return undefined;
  return compact;
}

/** 从最近七天真实标题中抽主题，不用固定热词或模型补词。 */
export function deriveWeixinChannelsSearchQueries(value: unknown) {
  const text = String(value || "").normalize("NFKC");
  const candidates: string[] = [];
  const hashtagPattern = /[#＃]([\u3400-\u9fffA-Za-z0-9]{2,12})/g;
  let hashtagMatch: RegExpExecArray | null;
  while ((hashtagMatch = hashtagPattern.exec(text)) !== null) candidates.push(hashtagMatch[1]!);
  candidates.push(...text.split(/[\s，,。.!！?？:：;；|｜/\\【】\[\]（）()《》“”"']+/g));
  if (!/\s/.test(text.trim())) candidates.push(text);
  const aiTopicPattern = /(?:AI|人工智能)(?:视频|影片|工作流|教程|工具|智能体|副业|营销|变现|漫剧(?:教程|制作)?)/gi;
  let aiTopicMatch: RegExpExecArray | null;
  while ((aiTopicMatch = aiTopicPattern.exec(text)) !== null) candidates.push(aiTopicMatch[0]!);
  const seen = new Set<string>();
  const normalized = candidates.flatMap((candidate) => {
    const query = normalizeWeixinChannelsSearchQuery(candidate);
    if (!query || seen.has(query.toLowerCase())) return [];
    seen.add(query.toLowerCase());
    return [query];
  });
  return normalized.filter((query, index, all) => !all.some((other, otherIndex) => (
    otherIndex !== index
      && other.toLowerCase().startsWith(query.toLowerCase())
      && Array.from(other).length > Array.from(query).length
  )));
}

/** 同一内容重复采集时保持稳定；时间戳不得进入幂等键。 */
export function makeWeixinChannelsObservationId(input: {
  taskId: string;
  title: string;
  author?: string;
  url?: string;
  videoIdentity?: string;
}) {
  const title = normalizeWeixinChannelsText(input.title);
  const author = normalizeWeixinChannelsText(input.author);
  const stableContentIdentity = input.url || title || author
    ? [input.url || "", author, title].join(":")
    : input.videoIdentity || "";
  const identity = [
    input.taskId,
    stableContentIdentity,
  ].join(":");
  return `wxco_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

const COMMENT_UI_NOISE = /^(评论|評論)(\s*\d+)?$|^(回复|回覆|展开|展開|收起|点赞|讚|赞|收藏|转发|轉發|分享|关注|關注|写评论|寫評論|说点什么|說點什麼|暂无评论|暫無評論|取消|发送|發送|全部)$/i;

export function cleanWeixinChannelsCommentTexts(lines: readonly string[]) {
  const seen = new Set<string>();
  return lines
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4 && line.length <= 500)
    .filter((line) => !COMMENT_UI_NOISE.test(line))
    .filter((line) => !/^\d+(?:\.\d+)?(?:万|萬|w)?\+?$/i.test(line))
    .filter((line) => {
      const key = normalizeWeixinChannelsText(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
