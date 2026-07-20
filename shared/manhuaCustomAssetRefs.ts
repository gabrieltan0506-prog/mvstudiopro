/**
 * 用户上传参考图：勾选人物 / 场景 / 服装道具后，直接进关键静帧融图。
 * 仅接受 HTTPS；unset 不进融图与门禁。
 */

export const MANHUA_CUSTOM_ASSET_ROLES = ["character", "scene", "prop"] as const;
export type ManhuaCustomAssetRole = (typeof MANHUA_CUSTOM_ASSET_ROLES)[number];
export type ManhuaCustomAssetRoleOrUnset = ManhuaCustomAssetRole | "unset";

export type ManhuaCustomAssetSource = "upload" | "generated";

export type ManhuaCustomAssetRef = {
  id: string;
  /** HTTPS 可读地址（GCS 等） */
  url: string;
  role: ManhuaCustomAssetRoleOrUnset;
  labelZh?: string;
  /** upload=用户上传；generated=基于库参考新生成（库仅为参考，不硬锁） */
  source?: ManhuaCustomAssetSource;
  /** 生成时参考的库资产 id（可选） */
  seedLibraryId?: string;
};

export const MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH: Record<ManhuaCustomAssetRoleOrUnset, string> = {
  character: "人物",
  scene: "场景",
  prop: "服装道具",
  unset: "未勾选",
};

function isHttpsUrl(u: string): boolean {
  return /^https:\/\//i.test(u);
}

export function makeManhuaCustomAssetId(): string {
  return `cust_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeManhuaCustomAssetRole(
  raw: unknown,
): ManhuaCustomAssetRoleOrUnset {
  const s = String(raw || "").trim();
  if (s === "character" || s === "scene" || s === "prop") return s;
  return "unset";
}

/** 清洗并截断用户上传参考列表（只留 HTTPS） */
export function normalizeManhuaCustomAssetRefs(
  raw: unknown,
  opts?: { max?: number },
): ManhuaCustomAssetRef[] {
  const max = Math.max(1, Math.min(24, opts?.max ?? 16));
  if (!Array.isArray(raw)) return [];
  const out: ManhuaCustomAssetRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Partial<ManhuaCustomAssetRef>;
    const url = String(o.url || "").trim();
    if (!isHttpsUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const id = String(o.id || "").trim() || makeManhuaCustomAssetId();
    const labelZh = String(o.labelZh || "").trim().slice(0, 40) || undefined;
    const source =
      o.source === "generated" || o.source === "upload" ? o.source : undefined;
    const seedLibraryId = String(o.seedLibraryId || "").trim() || undefined;
    out.push({
      id,
      url,
      role: normalizeManhuaCustomAssetRole(o.role),
      labelZh,
      source,
      seedLibraryId,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 基于库参考生成「新」资产图的提示（库只作气质/环境参考，禁止复刻同一张） */
export function buildManhuaCustomAssetGenFromLibraryPrompt(opts: {
  role: ManhuaCustomAssetRole;
  seedLabelZh?: string;
  seedPromptZh?: string;
  topic?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
}): string {
  const roleZh =
    opts.role === "character" ? "人物" : opts.role === "scene" ? "场景" : "服装道具";
  const seedLabel = String(opts.seedLabelZh || "").trim();
  const seedPrompt = String(opts.seedPromptZh || "").trim();
  const topic = String(opts.topic || "").trim();
  const styleLabel = String(opts.artStyleLabelZh || "").trim();
  const stylePrompt = String(opts.artStylePromptZh || "").trim();
  return [
    `生成一张竖版【漫剧·新${roleZh}参考图】（无可读文字、无字幕、无水印）：`,
    "硬规则：内建库条目仅作气质/环境/材质参考，必须生成**新**形象或新空镜，禁止复刻同一张脸或同一张示范封面。",
    opts.role === "character"
      ? "人物：单人清晰可读，服化道完整；可作后续分镜融图定妆参考。"
      : opts.role === "scene"
        ? "场景：空镜为主，环境层次与纵深清楚；可有远处剪影但不抢戏。"
        : "服装道具：主体居中、材质可读，背景干净，便于融进分镜。",
    seedLabel ? `库参考名：${seedLabel}（仅参考，勿复制）` : "",
    seedPrompt ? `库参考视觉：${seedPrompt.slice(0, 500)}` : "",
    topic ? `题材锚点：${topic.slice(0, 120)}` : "",
    styleLabel ? `【画风】${styleLabel}` : "",
    stylePrompt || "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 已勾选角色的参考（进融图 / 门禁） */
export function taggedManhuaCustomAssetRefs(
  refs: ManhuaCustomAssetRef[] | null | undefined,
): Array<ManhuaCustomAssetRef & { role: ManhuaCustomAssetRole }> {
  return normalizeManhuaCustomAssetRefs(refs).filter(
    (r): r is ManhuaCustomAssetRef & { role: ManhuaCustomAssetRole } =>
      r.role === "character" || r.role === "scene" || r.role === "prop",
  );
}

export function customRefsByRole(
  refs: ManhuaCustomAssetRef[] | null | undefined,
  role: ManhuaCustomAssetRole,
): Array<ManhuaCustomAssetRef & { role: ManhuaCustomAssetRole }> {
  return taggedManhuaCustomAssetRefs(refs).filter((r) => r.role === role);
}

export function hasCustomCastAndScene(
  refs: ManhuaCustomAssetRef[] | null | undefined,
): boolean {
  const tagged = taggedManhuaCustomAssetRefs(refs);
  return (
    tagged.some((r) => r.role === "character") && tagged.some((r) => r.role === "scene")
  );
}

export function summarizeCustomAssetRefsZh(
  refs: ManhuaCustomAssetRef[] | null | undefined,
): string {
  const tagged = taggedManhuaCustomAssetRefs(refs);
  if (!tagged.length) return "";
  const nChar = tagged.filter((r) => r.role === "character").length;
  const nScene = tagged.filter((r) => r.role === "scene").length;
  const nProp = tagged.filter((r) => r.role === "prop").length;
  const parts: string[] = [];
  if (nChar) parts.push(`人物 ${nChar}`);
  if (nScene) parts.push(`场景 ${nScene}`);
  if (nProp) parts.push(`服装道具 ${nProp}`);
  return parts.join(" · ");
}
