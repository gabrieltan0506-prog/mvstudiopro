/**
 * 漫剧 / 短剧合集：类别与题材标签（榜单与学节奏共用，前台用中文标签）。
 */

export type ManhuaDramaKind = "ai_manhua" | "short_drama" | "unknown";

export type ManhuaDramaPlatform = "douyin" | "kuaishou";

const AI_MANHUA_HINT_RE = /AI\s*漫剧|AI漫|动态漫|漫剧|条漫剧|AI\s*短剧|虚拟角色剧/i;
const AI_MANHUA_SOFT_TITLE_RE =
  /剑宗|师妹|仙盆|杂灵根|万妖图|罪妻开荒|团宠|重生之|穿越成|系统觉醒|修仙|灵根|宗门/;
const SHORT_DRAMA_HINT_RE = /短剧|红果|竖屏剧|微短剧|连载剧/;

/** 题材软标签白名单（有限，避免碎词） */
const TAG_RULES: Array<{ label: string; re: RegExp }> = [
  { label: "仙侠", re: /仙侠|修仙|宗门|灵根|剑宗|师妹|妖|仙/ },
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

export function isManhuaDramaMixCandidate(input: {
  isDrama?: boolean;
  dramaKind?: string;
  mixName?: string;
  title?: string;
  tags?: string[];
}): boolean {
  if (!input.isDrama && !input.mixName) return false;
  if (input.dramaKind === "ai_manhua" || input.dramaKind === "short_drama") return true;
  const hay = `${input.mixName || ""} ${input.title || ""} ${(input.tags || []).join(" ")}`;
  if (AI_MANHUA_HINT_RE.test(hay) || SHORT_DRAMA_HINT_RE.test(hay)) return true;
  if (AI_MANHUA_SOFT_TITLE_RE.test(hay)) return true;
  return Boolean(input.isDrama && input.mixName);
}
