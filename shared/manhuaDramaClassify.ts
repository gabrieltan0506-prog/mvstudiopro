/**
 * 漫剧 / 短剧合集：类别与题材标签（榜单与学节奏共用，前台用中文标签）。
 */

export type ManhuaDramaKind = "ai_manhua" | "short_drama" | "unknown";

export type ManhuaDramaPlatform = "douyin" | "kuaishou";

const AI_MANHUA_HINT_RE = /AI\s*漫剧|AI漫|动态漫|漫剧|条漫剧|AI\s*短剧|虚拟角色剧/i;
const AI_MANHUA_SOFT_TITLE_RE =
  /剑宗|师妹|仙盆|杂灵根|万妖图|罪妻开荒|团宠|重生之|穿越成|系统觉醒|修仙|灵根|宗门/;
const SHORT_DRAMA_HINT_RE = /短剧|红果|竖屏剧|微短剧|连载剧/;

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

export function inferManhuaDramaKind(text: string, tags: string[] = []): ManhuaDramaKind {
  const hay = `${text} ${tags.join(" ")}`.trim();
  if (!hay) return "unknown";
  if (AI_MANHUA_HINT_RE.test(hay)) return "ai_manhua";
  if (
    AI_MANHUA_SOFT_TITLE_RE.test(hay) &&
    (tags.includes("AI漫剧检索") || tags.includes("快手漫剧检索") || /漫|仙|妖|灵|宗|穿越|重生/.test(hay))
  ) {
    return "ai_manhua";
  }
  if (SHORT_DRAMA_HINT_RE.test(hay)) return "short_drama";
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
  // 过短且无剧类词：多为碎标题
  if (s.length <= 2 && !AI_MANHUA_HINT_RE.test(s) && !SHORT_DRAMA_HINT_RE.test(s)) return true;
  return false;
}

function hasStrongDramaLexical(text: string, tags: string[] = []): boolean {
  const hay = `${text} ${tags.join(" ")}`;
  return (
    AI_MANHUA_HINT_RE.test(hay)
    || SHORT_DRAMA_HINT_RE.test(hay)
    || AI_MANHUA_SOFT_TITLE_RE.test(hay)
  );
}

/**
 * 飙升榜候选门禁：
 * - 不再「有 mix_info 就算漫剧」——抖音大量普通合集会误入
 * - 需剧类词 / 明确 dramaKind / 或多集连载结构 + 合集名不像口播标题
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
    // 已有明确剧类：仍拒绝典型口播碎标题（多 hashtag / 教程分享等）
    if (mixName && looksLikeShortVideoCaption(mixName) && !hasStrongDramaLexical(mixName, [])) {
      // 极短正式剧名（如单字测试）允许；典型口播短语拒绝
      if (SHORT_VIDEO_CAPTION_RE.test(mixName) || (mixName.match(/#/g) || []).length >= 2) {
        return false;
      }
    }
    return Boolean(mixName || mixId);
  }

  // 合集名像口播标题：除非合集名本身含强剧类词，否则剔除
  if (mixName && looksLikeShortVideoCaption(mixName) && !hasStrongDramaLexical(mixName, [])) {
    return false;
  }

  const hay = `${mixName} ${input.title || ""} ${(input.tags || []).join(" ")}`;
  if (AI_MANHUA_HINT_RE.test(hay) || SHORT_DRAMA_HINT_RE.test(hay)) return true;
  if (AI_MANHUA_SOFT_TITLE_RE.test(hay)) return true;

  const eps = Number(input.totalEpisodes || 0);
  const cur = Number(input.currentEpisode || 0);
  // 多集连载结构：至少 3 集，且合集名可用
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
  const kind = inferManhuaDramaKind(`${mixName} ${title}`, tags);
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
