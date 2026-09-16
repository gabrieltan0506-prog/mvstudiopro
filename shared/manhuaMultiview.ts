/**
 * 0916 多视角建模（PR-7）：定妆图 → 四张白底正交视角图 → Tripo H3.1 multiview-to-3d。
 *
 * 纯函数层：视角枚举、改图提示词、视角集合稳定版本、签名 URL → gs:// 还原、草稿归一化。
 * 出图与提交都在客户端按既有付费入口走，这里不碰网络。
 */

export const MANHUA_MULTIVIEW_VIEWS = ["front", "left", "back", "right"] as const;
export type ManhuaMultiviewView = (typeof MANHUA_MULTIVIEW_VIEWS)[number];

export const MANHUA_MULTIVIEW_VIEW_LABEL_ZH: Record<ManhuaMultiviewView, string> = {
  front: "正面",
  left: "左侧",
  back: "背面",
  right: "右侧",
};

/** Tripo multiview-to-3d 的图片顺序固定：前/左/后/右 */
export const MANHUA_MULTIVIEW_ORDER: readonly ManhuaMultiviewView[] = MANHUA_MULTIVIEW_VIEWS;

export type ManhuaMultiviewDraftView = {
  view: ManhuaMultiviewView;
  /** 签名读链接（会过期），提交前若有 gs:// 由服务端重签 */
  url: string;
  gcsUri?: string;
  createdAt: number;
};

export type ManhuaMultiviewDraft = {
  /** 派生自哪一版定妆图（与 evaluateManhuaAsset3dEligibility 的 sourceVersion 同口径） */
  sourceVersion: string;
  views: ManhuaMultiviewDraftView[];
  updatedAt: number;
};

const VIEW_HINT_ZH: Record<ManhuaMultiviewView, string> = {
  front: "正面视图：人物/生物正对镜头，双眼（或面部）朝向观众，左右对称站立",
  left: "左侧视图：人物/生物整体向画面左转 90 度，镜头拍到它的左侧身，侧脸朝画面左边",
  back: "背面视图：人物/生物背对镜头，只看到后脑、后背与尾部/衣摆",
  right: "右侧视图：人物/生物整体向画面右转 90 度，镜头拍到它的右侧身，侧脸朝画面右边",
};

/**
 * 四视角改图提示词：保持造型/配色/伤口/道具完全一致，只换朝向；
 * 白底、正交、全身入镜、无阴影无文字——Tripo 多视角对背景与透视很敏感（0916 探针实测）。
 */
export function buildManhuaMultiviewPrompt(view: ManhuaMultiviewView, labelZh?: string): string {
  const who = String(labelZh || "").trim();
  return [
    `把这张${who ? `「${who}」` : ""}定妆图改成${VIEW_HINT_ZH[view]}。`,
    "造型、比例、配色、服饰、道具、伤口、眼罩等所有特征与原图完全一致，不新增不删减。",
    "纯白背景，正交视角（无透视畸变），全身完整入镜居中，四肢不遮挡身体轮廓，均匀柔光，无投影，无文字无水印。",
  ].join("");
}

/** 签名读链接 → gs://；不是 GCS 对象链接就返回空串（提交时省略 gs://，服务端按 https 直用） */
export function gsUriFromSignedGcsUrl(url: string): string {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    let bucket = "";
    let object = "";
    if (u.hostname === "storage.googleapis.com") {
      const parts = u.pathname.replace(/^\/+/, "").split("/");
      bucket = parts.shift() || "";
      object = parts.join("/");
    } else if (/^[a-z0-9._-]+\.storage\.googleapis\.com$/i.test(u.hostname)) {
      bucket = u.hostname.replace(/\.storage\.googleapis\.com$/i, "");
      object = u.pathname.replace(/^\/+/, "");
    } else {
      return "";
    }
    if (!bucket || !object) return "";
    return `gs://${bucket}/${decodeURIComponent(object)}`;
  } catch {
    return "";
  }
}

/** 视角图的稳定身份：优先 gs://，否则去掉查询串的 https（签名轮换不改身份） */
export function manhuaMultiviewImageIdentity(view: Pick<ManhuaMultiviewDraftView, "url" | "gcsUri">): string {
  const gs = String(view.gcsUri || "").trim();
  if (/^gs:\/\//i.test(gs)) return gs;
  const derived = gsUriFromSignedGcsUrl(view.url);
  if (derived) return derived;
  try {
    const u = new URL(String(view.url || ""));
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return String(view.url || "").trim();
  }
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 视角集合版本（进服务端幂等摘要，≤4096 字）：按前/左/后/右顺序拼身份；
 * 同一组图换签名不变，任一张重出即变。
 */
export function computeManhuaMultiviewVersion(views: readonly ManhuaMultiviewDraftView[]): string {
  const ordered = orderManhuaMultiviewViews(views);
  const identity = ordered.map((v) => `${v.view}=${manhuaMultiviewImageIdentity(v)}`).join("|");
  const full = `mv1:${identity}`;
  if (full.length <= 4_000) return full;
  return `mv1h:${fnv1a(identity)}:${ordered.length}`;
}

/** 去重并按 Tripo 顺序排：同一视角保留最新一张 */
export function orderManhuaMultiviewViews(views: readonly ManhuaMultiviewDraftView[]): ManhuaMultiviewDraftView[] {
  const latest = new Map<ManhuaMultiviewView, ManhuaMultiviewDraftView>();
  for (const v of views) {
    const prev = latest.get(v.view);
    if (!prev || v.createdAt >= prev.createdAt) latest.set(v.view, v);
  }
  return MANHUA_MULTIVIEW_ORDER.flatMap((view) => {
    const hit = latest.get(view);
    return hit ? [hit] : [];
  });
}

export type ManhuaMultiviewReadiness =
  | { ready: true; views: ManhuaMultiviewDraftView[]; version: string }
  | { ready: false; reasonZh: string; missing: ManhuaMultiviewView[] };

/** 提交门槛：正面必有，总数 2–4；缺的视角列出来给 UI 补出 */
export function evaluateManhuaMultiviewReadiness(
  draft: ManhuaMultiviewDraft | null | undefined,
  sourceVersion: string,
): ManhuaMultiviewReadiness {
  const missingAll = [...MANHUA_MULTIVIEW_VIEWS];
  if (!draft) return { ready: false, reasonZh: "还没有四视角图", missing: missingAll };
  if (draft.sourceVersion !== sourceVersion) {
    return { ready: false, reasonZh: "定妆图已换，四视角图需按新图重出", missing: missingAll };
  }
  const ordered = orderManhuaMultiviewViews(draft.views);
  const have = new Set(ordered.map((v) => v.view));
  const missing = MANHUA_MULTIVIEW_VIEWS.filter((v) => !have.has(v));
  if (!have.has("front")) return { ready: false, reasonZh: "缺正面视图（Tripo 必填）", missing };
  if (ordered.length < 2) return { ready: false, reasonZh: "至少要正面加一张侧/背视图", missing };
  return { ready: true, views: ordered, version: computeManhuaMultiviewVersion(ordered) };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** 存稿归一化：只收合法视角 + https；坏项丢弃，整体为空则不存 */
export function normalizeManhuaMultiviewDraft(raw: unknown): ManhuaMultiviewDraft | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaMultiviewDraft>;
  const sourceVersion = String(o.sourceVersion || "").trim().slice(0, 4_096);
  if (!sourceVersion || !Array.isArray(o.views)) return undefined;
  const views: ManhuaMultiviewDraftView[] = [];
  for (const item of o.views) {
    if (!item || typeof item !== "object") continue;
    const v = item as Partial<ManhuaMultiviewDraftView>;
    const view = String(v.view || "") as ManhuaMultiviewView;
    const url = String(v.url || "").trim();
    if (!MANHUA_MULTIVIEW_VIEWS.includes(view) || !isHttpsUrl(url)) continue;
    const gcsUri = /^gs:\/\//i.test(String(v.gcsUri || "")) ? String(v.gcsUri).trim() : undefined;
    const createdAt = Number(v.createdAt);
    views.push({ view, url, ...(gcsUri ? { gcsUri } : {}), createdAt: Number.isFinite(createdAt) ? createdAt : 0 });
  }
  if (!views.length) return undefined;
  const updatedAt = Number(o.updatedAt);
  return { sourceVersion, views: orderManhuaMultiviewViews(views), updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
}

/** 合并一张新出的视角图：定妆图同版则覆盖同视角、保留其余；换版则整组重来 */
export function mergeManhuaMultiviewDraft(
  existing: ManhuaMultiviewDraft | null | undefined,
  sourceVersion: string,
  produced: ManhuaMultiviewDraftView,
  now = Date.now(),
): ManhuaMultiviewDraft {
  const keep = existing && existing.sourceVersion === sourceVersion ? existing.views.filter((v) => v.view !== produced.view) : [];
  return { sourceVersion, views: orderManhuaMultiviewViews([...keep, produced]), updatedAt: now };
}
