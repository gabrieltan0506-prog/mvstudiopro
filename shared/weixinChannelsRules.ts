import { createHash } from "node:crypto";

/** 达到 1,000 条即建立正式整理任务；单次最多交给 Terra 2,000 条。 */
export const WEIXIN_CHANNELS_ACCUMULATION_TARGET = 1_000;
export const WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS = 2_000;
/** Terra 1.05M 总上下文中为 100K 输出及协议开销留出空间。 */
export const WEIXIN_CHANNELS_TERRA_INPUT_TOKEN_BUDGET = 900_000;
export const WEIXIN_CHANNELS_TERRA_MAX_COMPLETION_TOKENS = 100_000;
/** 仅用于读取旧版状态，不再创建新的 Luna 批次。 */
export const WEIXIN_CHANNELS_LUNA_BATCH_SIZE = 100;
export const WEIXIN_CHANNELS_PROBE_TARGET = 5;
export const WEIXIN_CHANNELS_COMMENT_THRESHOLD = 80;

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
  return (ocrTexts || []).some((text) => String(text || "").replace(/\s+/g, "").includes("广告"));
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

  const comments = Math.max(0, Number(item.comments) || 0);
  if (comments >= WEIXIN_CHANNELS_COMMENT_THRESHOLD) {
    return {
      qualified: true,
      invalid: false,
      reason: "评论讨论达到采集门槛",
      requiresComments: true,
    };
  }

  const strongSignals = [
    (Number(item.likes) || 0) >= 2_000,
    (Number(item.shares) || 0) >= 1_000,
    (Number(item.favorites) || 0) >= 1_000,
  ].filter(Boolean).length;
  if (strongSignals >= 2) {
    return {
      qualified: true,
      invalid: false,
      reason: "多个互动指标同时达到高热门槛",
      requiresComments: false,
    };
  }

  return {
    qualified: false,
    invalid: false,
    reason: "互动指标不足，仅记录扫描结果，不进入模型队列",
    requiresComments: false,
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

/** 同一内容重复采集时保持稳定；时间戳不得进入幂等键。 */
export function makeWeixinChannelsObservationId(input: {
  taskId: string;
  title: string;
  author?: string;
  url?: string;
}) {
  const identity = [
    input.taskId,
    input.url || "",
    normalizeWeixinChannelsText(input.author),
    normalizeWeixinChannelsText(input.title),
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
