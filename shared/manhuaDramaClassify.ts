/**
 * 漫剧 / 短剧合集：类别与题材标签（榜单与学节奏共用，前台用中文标签）。
 */

export type ManhuaDramaKind = "ai_manhua" | "short_drama" | "unknown";

export type ManhuaDramaPlatform = "douyin" | "kuaishou";

/** 飙升榜最多展示部数（含漫剧+确认短剧，不足亦展示） */
export const AI_MANHUA_RISING_BOARD_LIMIT = 15;

const AI_MANHUA_HINT_RE = /AI\s*漫剧|AI漫|动态漫|漫剧|条漫剧|AI\s*短剧|虚拟角色剧/i;
const AI_MANHUA_SOFT_TITLE_RE =
  /剑宗|师妹|仙盆|杂灵根|万妖图|罪妻开荒|团宠|重生之|穿越成|系统觉醒|修仙|灵根|宗门/;
/** 短剧强信号：避免单条口播标题里偶然出现「短剧」二字 */
const SHORT_DRAMA_STRONG_RE = /红果|竖屏剧|微短剧|短剧合集|AI\s*短剧/;
/** 短剧弱信号：仅当出现在合集名时采信 */
const SHORT_DRAMA_MIX_NAME_RE = /短剧|连载剧/;

/** 口播/二创短视频标题特征（非剧名合集） */
const SHORT_VIDEO_CAPTION_RE =
  /一人一句|插画|教程|分享|日记本|日记|打卡|学画|学绘画|出门教|布置|vlog|日常|二创|混剪|剪辑|壁纸|表情包|#\s*music|#\s*illustration|唯美动漫|动漫分享|看着屏幕/i;

/** 题材软标签白名单（有限，避免碎词） */
const TAG_RULES: Array<{ label: string; re: RegExp }> = [
  { label: "仙侠", re: /仙侠|修仙|宗门|灵根|剑宗|师妹/ },
  { label: "重生", re: /重生|重来|再世/ },
  { label: "穿越", re: /穿越|穿成|穿书/ },
  { label: "系统", re: /系统|签到|面板|任务流/ },
  { label: "逆袭", re: /逆袭|打脸|赘婿|翻盘/ },
  { label: "古言", re: /古言|种田|开荒|宫廷|王爷/ },
  { label: "甜宠", re: /甜宠|恋爱|宠妻|双强/ },
  { label: "悬疑", re: /悬疑|权谋|复仇|密室/ },
  { label: "都市", re: /都市|职场|豪门|战神/ },
  { label: "搞笑", re: /沙雕|搞笑|整活|喜剧/ },
];

/**
 * @param text 成片标题等辅助文本
 * @param tags 标签
 * @param mixName 合集名（短剧弱词必须落在合集名上，防短视频误标）
 */
export function inferManhuaDramaKind(
  text: string,
  tags: string[] = [],
  mixName = "",
): ManhuaDramaKind {
  const mix = String(mixName || "").trim();
  const hay = `${mix} ${text} ${tags.join(" ")}`.trim();
  if (!hay) return "unknown";
  if (AI_MANHUA_HINT_RE.test(hay)) return "ai_manhua";
  if (
    AI_MANHUA_SOFT_TITLE_RE.test(hay) &&
    (tags.includes("AI漫剧检索") || tags.includes("快手漫剧检索") || /漫|仙|妖|灵|宗|穿越|重生/.test(hay))
  ) {
    return "ai_manhua";
  }
  if (SHORT_DRAMA_STRONG_RE.test(hay)) return "short_drama";
  // 弱词「短剧/连载剧」只认合集名，不认单条短视频文案
  if (mix && SHORT_DRAMA_MIX_NAME_RE.test(mix)) return "short_drama";
  if (AI_MANHUA_SOFT_TITLE_RE.test(hay)) return "ai_manhua";
  return "unknown";
}

export function manhuaDramaCategoryLabelZh(kind: ManhuaDramaKind | string | undefined): string {
  if (kind === "ai_manhua") return "AI漫剧";
  if (kind === "short_drama") return "短剧合集";
  return "待判定";
}

/** 从标题/合集名/标签抽题材标签（最多 4 个） */
export function extractManhuaDramaTagLabelsZh(
  text: string,
  tags: string[] = [],
  max = 4,
): string[] {
  const hay = `${text} ${tags.join(" ")}`;
  const out: string[] = [];
  for (const rule of TAG_RULES) {
    if (rule.re.test(hay) && !out.includes(rule.label)) {
      out.push(rule.label);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * 前台展示标签：优先带上「AI + 漫剧」或「AI + 短剧」/「短剧」，再拼题材软标签。
 */
export function buildManhuaDramaDisplayTagsZh(
  kind: ManhuaDramaKind | string | undefined,
  text: string,
  tags: string[] = [],
  max = 5,
): string[] {
  const hay = `${text} ${tags.join(" ")}`;
  const prefix: string[] = [];
  if (kind === "ai_manhua") {
    prefix.push("AI", "漫剧");
  } else if (kind === "short_drama") {
    if (/AI\s*短剧|AI\s*漫剧|AI漫|动态漫/i.test(hay)) {
      prefix.push("AI", "短剧");
    } else {
      prefix.push("短剧");
    }
  }
  const softBudget = Math.max(0, max - prefix.length);
  const soft = extractManhuaDramaTagLabelsZh(text, tags, softBudget);
  return Array.from(new Set([...prefix, ...soft])).slice(0, max);
}

/** 规范化剧名作伪合集键（快手无 mix_id 时） */
export function normalizeManhuaMixNameKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[《》【】\[\]（）()·・\.。,，!！?？:：'"“”‘’]/g, "")
    .slice(0, 48);
}

/** 是否像短视频口播/二创标题，而非连载剧名 */
export function looksLikeShortVideoCaption(text: string): boolean {
  const s = String(text || "").trim();
  if (!s) return true;
  const hashCount = (s.match(/#/g) || []).length;
  if (hashCount >= 2) return true;
  if (SHORT_VIDEO_CAPTION_RE.test(s)) return true;
  if (
    s.length <= 2
    && !AI_MANHUA_HINT_RE.test(s)
    && !SHORT_DRAMA_STRONG_RE.test(s)
    && !SHORT_DRAMA_MIX_NAME_RE.test(s)
  ) {
    return true;
  }
  return false;
}

function hasStrongDramaLexical(text: string, tags: string[] = []): boolean {
  const hay = `${text} ${tags.join(" ")}`;
  return (
    AI_MANHUA_HINT_RE.test(hay)
    || SHORT_DRAMA_STRONG_RE.test(hay)
    || SHORT_DRAMA_MIX_NAME_RE.test(hay)
    || AI_MANHUA_SOFT_TITLE_RE.test(hay)
  );
}

/**
 * 飙升榜候选门禁：
 * - 不再「有 mix_info 就算漫剧」——抖音大量普通合集会误入
 * - 短剧须合集名/强信号确认，避免短视频误判为短剧
 */
export function isManhuaDramaMixCandidate(input: {
  isDrama?: boolean;
  dramaKind?: string;
  mixName?: string;
  mixId?: string;
  title?: string;
  tags?: string[];
  totalEpisodes?: number;
  currentEpisode?: number;
}): boolean {
  const mixName = String(input.mixName || "").trim();
  const mixId = String(input.mixId || "").trim();
  if (!mixName && !mixId) return false;

  if (input.dramaKind === "ai_manhua" || input.dramaKind === "short_drama") {
    if (mixName && looksLikeShortVideoCaption(mixName) && !hasStrongDramaLexical(mixName, [])) {
      if (SHORT_VIDEO_CAPTION_RE.test(mixName) || (mixName.match(/#/g) || []).length >= 2) {
        return false;
      }
    }
    // short_drama：额外要求合集名或强信号，防止成片标题误标后仍进榜
    if (input.dramaKind === "short_drama") {
      const okShort =
        SHORT_DRAMA_STRONG_RE.test(`${mixName} ${input.title || ""}`)
        || (mixName.length > 0 && SHORT_DRAMA_MIX_NAME_RE.test(mixName));
      if (!okShort) return false;
    }
    return Boolean(mixName || mixId);
  }

  if (mixName && looksLikeShortVideoCaption(mixName) && !hasStrongDramaLexical(mixName, [])) {
    return false;
  }

  const hay = `${mixName} ${input.title || ""} ${(input.tags || []).join(" ")}`;
  if (AI_MANHUA_HINT_RE.test(hay)) return true;
  if (SHORT_DRAMA_STRONG_RE.test(hay)) return true;
  if (mixName && SHORT_DRAMA_MIX_NAME_RE.test(mixName)) return true;
  if (AI_MANHUA_SOFT_TITLE_RE.test(hay)) return true;

  const eps = Number(input.totalEpisodes || 0);
  const cur = Number(input.currentEpisode || 0);
  // 多集连载 + 合集名可用：可进榜，类别多为「待判定」（不自动标短剧）
  if (input.isDrama && mixName && eps >= 3 && !looksLikeShortVideoCaption(mixName)) {
    return true;
  }
  if (input.isDrama && mixName && cur >= 1 && eps >= 2 && !looksLikeShortVideoCaption(mixName)) {
    return true;
  }

  return false;
}

/** 采集侧：是否值得写入 isDrama（比榜单门禁略宽，仍拒绝纯口播合集） */
export function shouldMarkDouyinMixAsDrama(input: {
  mixName?: string;
  mixId?: string;
  title?: string;
  tags?: string[];
  totalEpisodes?: number;
  currentEpisode?: number;
}): { isDrama: boolean; dramaKind: ManhuaDramaKind } {
  const mixName = String(input.mixName || "").trim();
  const title = String(input.title || "").trim();
  const tags = input.tags || [];
  const kind = inferManhuaDramaKind(title, tags, mixName);
  if (kind === "ai_manhua" || kind === "short_drama") {
    return { isDrama: true, dramaKind: kind };
  }
  if (isManhuaDramaMixCandidate({
    isDrama: true,
    dramaKind: kind,
    mixName,
    mixId: input.mixId,
    title,
    tags,
    totalEpisodes: input.totalEpisodes,
    currentEpisode: input.currentEpisode,
  })) {
    return { isDrama: true, dramaKind: kind };
  }
  return { isDrama: false, dramaKind: "unknown" };
}
