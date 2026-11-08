/**
 * 漫剧 · 共用素材检索（图库）接入口径（2026-11-08）。
 *
 * 硬边界：图库素材在漫剧里只有两种身份——
 * - reference：场景参考图（进「我的场景」，只当空间/画风参考，不直接入片）；
 * - empty_shot：无人物空镜（登记为某一段的片段，进多轨剪辑与导出）。
 * 不能当人物、不能进角色资产/角色卡、不能替换既定角色、不能作为下一段的人物连续性锚点。
 *
 * 业务数据里只存资产身份（assetId + gcsUri）与署名证据；签名读链只作展示/提交时的当前读链。
 */
import type { ManhuaSegmentReferenceEntry } from "./manhuaSegmentReference.js";
import {
  PEXELS_LICENSE,
  assertStockUsageAllowed,
  stockAttributionText,
  type StockFootageAsset,
  type StockFootageAssetView,
} from "./stockFootage.js";

export type ManhuaStockFootageUsage = "reference" | "empty_shot";

/** 挂在场景参考图 / 登记空镜上的图库来源标记（随草稿持久化）。 */
export type ManhuaStockFootageMark = {
  source: "stock";
  provider: "pexels";
  /** sf_ + 48 位十六进制；服务端据此 loadOwnedStockAsset 核对归属 */
  assetId: string;
  usage: ManhuaStockFootageUsage;
  /** 署名：「作者 / Pexels」 */
  attributionZh: string;
  authorName: string;
  pageUrl?: string;
  licenseUrl: string;
  /** 仅空镜：用户勾选「画面无人物」的时间（ISO）；没有该确认的空镜不收。 */
  noPersonConfirmedAt?: string;
  /** 仅空镜：素材真实时长与登记时选的裁点（源片绝对秒）；细剪只能在这个窗口内动。 */
  sourceDurationSec?: number;
  trimInSec?: number;
  trimOutSec?: number;
};

/** 空镜在源片里的可用窗口（绝对秒）。 */
export type ManhuaStockEmptyShotWindow = { sourceDurationSec: number; inSec: number; outSec: number };

const ASSET_ID_RE = /^sf_[0-9a-f]{48}$/;

function httpsOrUndefined(value: unknown, max = 1000): string | undefined {
  const s = String(value || "").trim();
  if (!s || s.length > max) return undefined;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 草稿/云端白名单入口：非法项返回 undefined。
 * expectUsage 给出时，用法不符也视为无效（场景参考位不收空镜标记，反之亦然）。
 */
export function normalizeManhuaStockFootageMark(
  raw: unknown,
  expectUsage?: ManhuaStockFootageUsage,
): ManhuaStockFootageMark | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.source !== "stock" || o.provider !== "pexels") return undefined;
  const assetId = String(o.assetId || "").trim();
  if (!ASSET_ID_RE.test(assetId)) return undefined;
  const usage = o.usage === "reference" || o.usage === "empty_shot" ? o.usage : undefined;
  if (!usage || (expectUsage && usage !== expectUsage)) return undefined;
  const authorName = String(o.authorName || "").trim().slice(0, 300);
  const attributionZh = String(o.attributionZh || "").trim().slice(0, 400) || (authorName ? `${authorName} / Pexels` : "");
  if (!attributionZh) return undefined;
  const noPersonConfirmedAt = String(o.noPersonConfirmedAt || "").trim();
  if (usage === "empty_shot" && !noPersonConfirmedAt) return undefined;
  const window = usage === "empty_shot" ? normalizeWindow(o.sourceDurationSec, o.trimInSec, o.trimOutSec) : undefined;
  if (usage === "empty_shot" && !window) return undefined;
  const pageUrl = httpsOrUndefined(o.pageUrl);
  return {
    source: "stock",
    provider: "pexels",
    assetId,
    usage,
    attributionZh,
    authorName,
    ...(pageUrl ? { pageUrl } : {}),
    licenseUrl: httpsOrUndefined(o.licenseUrl) || PEXELS_LICENSE.url,
    ...(usage === "empty_shot" && window
      ? {
          noPersonConfirmedAt: noPersonConfirmedAt.slice(0, 40),
          sourceDurationSec: window.sourceDurationSec,
          trimInSec: window.inSec,
          trimOutSec: window.outSec,
        }
      : {}),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 裁点窗口白名单：时长 ≥0.5，0 ≤ in，out ≤ 时长，至少保留 0.5 秒。 */
function normalizeWindow(srcRaw: unknown, inRaw: unknown, outRaw: unknown): ManhuaStockEmptyShotWindow | undefined {
  const src = Number(srcRaw);
  const a = Number(inRaw);
  const b = Number(outRaw);
  if (![src, a, b].every(Number.isFinite) || src < 0.5 || src > 3600) return undefined;
  if (a < 0 || b > src + 0.001 || b - a < 0.5 - 0.001) return undefined;
  return { sourceDurationSec: round2(src), inSec: round2(a), outSec: round2(Math.min(b, src)) };
}

/** 采用回执 → 漫剧标记；用途/用法不对直接抛错（不允许 manhua+insert）。 */
export function manhuaStockMarkFromAsset(
  asset: Pick<StockFootageAsset, "assetId" | "purpose" | "usage" | "source">,
  usage: ManhuaStockFootageUsage,
  opts?: { noPersonConfirmedAt?: string; window?: ManhuaStockEmptyShotWindow },
): ManhuaStockFootageMark {
  if (asset.purpose !== "manhua") throw new Error("该图库素材不是为漫剧采用的，请在漫剧里重新采用");
  assertStockUsageAllowed(asset.purpose, asset.usage);
  if (asset.usage !== usage) {
    throw new Error(usage === "reference" ? "该素材是按空镜采用的，不能当场景参考图" : "该素材是按参考图采用的，不能当空镜入片");
  }
  const mark = normalizeManhuaStockFootageMark(
    {
      source: "stock",
      provider: asset.source.provider,
      assetId: asset.assetId,
      usage,
      attributionZh: stockAttributionText(asset.source),
      authorName: asset.source.author.name,
      pageUrl: asset.source.pageUrl,
      licenseUrl: asset.source.license.url,
      noPersonConfirmedAt: opts?.noPersonConfirmedAt,
      sourceDurationSec: opts?.window?.sourceDurationSec,
      trimInSec: opts?.window?.inSec,
      trimOutSec: opts?.window?.outSec,
    },
    usage,
  );
  if (!mark) {
    if (usage === "empty_shot" && !opts?.noPersonConfirmedAt) throw new Error("请先确认空镜画面中没有人物");
    throw new Error(usage === "empty_shot" ? "空镜裁点或来源信息无效，未登记" : "图库素材来源信息不完整，未挂上");
  }
  return mark;
}

/** 空镜裁点：不越过素材时长，至少保留 0.5 秒；输入非法时回落到 [0, min(时长, 期望长度)]。 */
export function clampManhuaStockEmptyShotTrim(
  sourceDurationSec: number,
  inSec: number,
  outSec: number,
): { inSec: number; outSec: number } {
  const dur = Number(sourceDurationSec);
  if (!Number.isFinite(dur) || dur < 0.5) throw new Error("空镜素材缺少可用时长");
  const round = (v: number) => Math.round(v * 100) / 100;
  let a = Number.isFinite(Number(inSec)) ? Math.max(0, Math.min(Number(inSec), dur - 0.5)) : 0;
  let b = Number.isFinite(Number(outSec)) ? Math.max(0, Math.min(Number(outSec), dur)) : dur;
  if (b - a < 0.5) {
    b = Math.min(dur, a + 0.5);
    a = Math.max(0, b - 0.5);
  }
  return { inSec: round(a), outSec: round(b) };
}

/** 登记空镜时与该段规划时长的容差（与「登记已有成片」同口径）。 */
export const MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC = 1.5;

/**
 * 校验一段空镜登记请求，返回落档用的裁点。
 * 反向：非空镜用法、照片、无时长、未勾选无人物、裁点越界、裁后长度与段规划差太多。
 */
export function validateManhuaStockEmptyShot(input: {
  asset: Pick<StockFootageAsset, "assetId" | "purpose" | "usage" | "kind" | "durationSec" | "source" | "gcsUri">;
  inSec: number;
  outSec: number;
  plannedDurationSec: number;
  noPersonConfirmed: boolean;
}): { inSec: number; outSec: number; sourceDurationSec: number } {
  const { asset } = input;
  if (asset.purpose !== "manhua" || asset.usage !== "empty_shot") throw new Error("只有按「漫剧空镜」采用的图库视频才能登记为空镜");
  if (asset.kind !== "video") throw new Error("空镜只收视频素材");
  if (!/^gs:\/\/[^/]+\/.+/.test(String(asset.gcsUri || ""))) throw new Error("空镜素材缺少存储身份");
  if (!input.noPersonConfirmed) throw new Error("请先勾选确认画面中没有人物");
  const dur = Number(asset.durationSec);
  if (!Number.isFinite(dur) || dur < 0.5) throw new Error("空镜素材缺少可用时长");
  const inSec = Number(input.inSec);
  const outSec = Number(input.outSec);
  if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec > dur + 0.001 || outSec - inSec < 0.5) {
    throw new Error(`裁点需在 0–${dur.toFixed(1)} 秒内，且至少保留 0.5 秒`);
  }
  const planned = Number(input.plannedDurationSec);
  if (Number.isFinite(planned) && planned > 0 && Math.abs(outSec - inSec - planned) > MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC) {
    throw new Error(`本段规划约 ${planned} 秒，空镜裁后 ${(outSec - inSec).toFixed(1)} 秒，相差超过 ${MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC} 秒，请调整裁点`);
  }
  return { inSec: Math.round(inSec * 100) / 100, outSec: Math.round(outSec * 100) / 100, sourceDurationSec: dur };
}

/** 段成片当前就是图库空镜（只认登记位的标记且产物地址同对象）。 */
export function isManhuaStockEmptyShotClip(block: {
  outputUrl?: string | null;
  manhuaSegmentRefs?: { registered?: { url?: string; gcsUri?: string; stockFootage?: unknown } };
}): boolean {
  const reg = block.manhuaSegmentRefs?.registered;
  if (!reg || !normalizeManhuaStockFootageMark(reg.stockFootage, "empty_shot")) return false;
  const out = String(block.outputUrl || "").trim();
  if (!out) return false;
  if (reg.url && out === reg.url) return true;
  return Boolean(reg.gcsUri && gsIdentityOfUrl(out) === reg.gcsUri);
}

/** storage.googleapis.com 签名链 → gs://bucket/object；其他返回 undefined。 */
export function gsIdentityOfUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "storage.googleapis.com") return undefined;
    const path = decodeURIComponent(u.pathname.slice(1));
    return path.includes("/") ? `gs://${path}` : undefined;
  } catch {
    return undefined;
  }
}

function sameObjectOrUnknown(url: string, gcsUri: string): boolean {
  const identity = gsIdentityOfUrl(url);
  return !identity || identity === gcsUri;
}

/**
 * 采用回执（usage=reference 的照片）→ 「我的场景」里的一张场景参考图。
 * 只当空间（默认）/画风参考，恒为 scene，不进人物/角色卡；落档只认 gcsUri + assetId，
 * url 只是当前签名读链（过期后按 gcsUri 现签，与其他上传参考同一条续签链）。
 */
export function buildManhuaSceneReferenceFromStock(
  asset: StockFootageAssetView,
  id: string,
): {
  id: string;
  url: string;
  gcsUri: string;
  role: "scene";
  refDuty: "space";
  labelZh: string;
  source: "upload";
  sourceWidth: number;
  sourceHeight: number;
  stockFootage: ManhuaStockFootageMark;
} {
  if (asset.kind !== "photo") throw new Error("场景参考只收图片素材");
  const mark = manhuaStockMarkFromAsset(asset, "reference");
  const url = String(asset.url || "").trim();
  const gcsUri = String(asset.gcsUri || "").trim();
  if (!/^https:\/\//i.test(url) || !/^gs:\/\/[^/]+\/.+/.test(gcsUri) || !sameObjectOrUnknown(url, gcsUri)) {
    throw new Error("图库素材读链无效，请重新采用");
  }
  return {
    id,
    url,
    gcsUri,
    role: "scene",
    refDuty: "space",
    labelZh: "图库场景",
    source: "upload",
    sourceWidth: asset.width,
    sourceHeight: asset.height,
    stockFootage: mark,
  };
}

/**
 * 采用回执（usage=empty_shot 的视频）+ 裁点 + 无人物确认 → 本段登记成片用料。
 * entry 走既有「登记已有成片」链（setManhuaSegmentReference registered 位）；
 * editTrim 是落到成片节点 manhuaEditTrim 的裁切合同（合成按它裁）。
 */
export function buildManhuaStockEmptyShotRegistration(input: {
  asset: StockFootageAssetView;
  inSec: number;
  outSec: number;
  plannedDurationSec: number;
  noPersonConfirmed: boolean;
  nowIso: string;
}): {
  entry: ManhuaSegmentReferenceEntry;
  window: ManhuaStockEmptyShotWindow;
  editTrim: { sourceDurationSec: number; inSec: number; outSec: number; updatedAt: number };
} {
  const { asset } = input;
  const checked = validateManhuaStockEmptyShot({
    asset,
    inSec: input.inSec,
    outSec: input.outSec,
    plannedDurationSec: input.plannedDurationSec,
    noPersonConfirmed: input.noPersonConfirmed,
  });
  const url = String(asset.url || "").trim();
  if (!/^https:\/\//i.test(url) || !sameObjectOrUnknown(url, asset.gcsUri)) throw new Error("图库空镜读链无效，请重新采用");
  const window: ManhuaStockEmptyShotWindow = {
    sourceDurationSec: Math.round(checked.sourceDurationSec * 100) / 100,
    inSec: checked.inSec,
    outSec: checked.outSec,
  };
  const mark = manhuaStockMarkFromAsset(asset, "empty_shot", { noPersonConfirmedAt: input.nowIso, window });
  const updatedAt = Date.parse(input.nowIso);
  return {
    entry: {
      url,
      gcsUri: asset.gcsUri,
      fileName: `pexels-${asset.source.providerAssetId}.mp4`,
      durationSec: checked.sourceDurationSec,
      stockFootage: mark,
      updatedAt: input.nowIso,
    },
    window,
    editTrim: {
      sourceDurationSec: window.sourceDurationSec,
      inSec: window.inSec,
      outSec: window.outSec,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    },
  };
}

type ClipLike = Parameters<typeof isManhuaStockEmptyShotClip>[0];

/** 当前成片就是图库空镜时返回其标记（含裁点窗口）；否则 undefined。 */
export function manhuaStockEmptyShotMarkOf(block: ClipLike): ManhuaStockFootageMark | undefined {
  if (!isManhuaStockEmptyShotClip(block)) return undefined;
  return normalizeManhuaStockFootageMark(block.manhuaSegmentRefs?.registered?.stockFootage, "empty_shot");
}

export function manhuaStockEmptyShotWindowOf(block: ClipLike): ManhuaStockEmptyShotWindow | undefined {
  const mark = manhuaStockEmptyShotMarkOf(block);
  if (!mark || mark.sourceDurationSec == null || mark.trimInSec == null || mark.trimOutSec == null) return undefined;
  return { sourceDurationSec: mark.sourceDurationSec, inSec: mark.trimInSec, outSec: mark.trimOutSec };
}

type PieceLike = { shotIndex: number; timelineOrder?: number; trimInSec: number; trimOutSec: number; durationSec: number };
type TrimLike = { sourceDurationSec?: number; inSec: number; outSec: number; shotPieces?: PieceLike[]; updatedAt?: number };

function clampSpan(a: number, b: number, lo: number, hi: number): [number, number] {
  let x = Math.max(lo, Math.min(Number.isFinite(a) ? a : lo, hi - 0.5));
  let y = Math.min(hi, Math.max(Number.isFinite(b) ? b : hi, x + 0.5));
  if (y - x < 0.5) {
    x = Math.max(lo, y - 0.5);
    y = Math.min(hi, x + 0.5);
  }
  return [round2(x), round2(y)];
}

/** 绝对秒裁切合同收进空镜窗口（落档前兜底）：整体与各镜片都不越过登记裁点与素材时长。 */
export function clampManhuaEditTrimToStockWindow<T extends TrimLike>(trim: T, window: ManhuaStockEmptyShotWindow): T {
  const [inSec, outSec] = clampSpan(trim.inSec, trim.outSec, window.inSec, window.outSec);
  return {
    ...trim,
    sourceDurationSec: window.sourceDurationSec,
    inSec,
    outSec,
    ...(trim.shotPieces
      ? {
          shotPieces: trim.shotPieces.map((piece) => {
            const [a, b] = clampSpan(piece.trimInSec, piece.trimOutSec, window.inSec, window.outSec);
            return { ...piece, trimInSec: a, trimOutSec: b, durationSec: round2(b - a) };
          }),
        }
      : {}),
  };
}

/** 细剪按「窗口内相对秒」算出的合同 → 源片绝对秒（平移 window.inSec 后再收进窗口）。 */
export function placeManhuaEditTrimInStockWindow<T extends TrimLike>(trim: T, window: ManhuaStockEmptyShotWindow): T {
  return clampManhuaEditTrimToStockWindow(
    {
      ...trim,
      inSec: trim.inSec + window.inSec,
      outSec: trim.outSec + window.inSec,
      ...(trim.shotPieces
        ? {
            shotPieces: trim.shotPieces.map((piece) => ({
              ...piece,
              trimInSec: piece.trimInSec + window.inSec,
              trimOutSec: piece.trimOutSec + window.inSec,
            })),
          }
        : {}),
    },
    window,
  );
}

/** 恢复细剪时的逆变换：绝对秒镜片 → 窗口内相对秒。 */
export function localizeManhuaStockEmptyShotPieces<P extends PieceLike>(pieces: readonly P[], window: ManhuaStockEmptyShotWindow): P[] {
  const span = window.outSec - window.inSec;
  return pieces.map((piece) => {
    const [a, b] = clampSpan(piece.trimInSec - window.inSec, piece.trimOutSec - window.inSec, 0, span);
    return { ...piece, trimInSec: a, trimOutSec: b, durationSec: round2(b - a) };
  });
}

export type ManhuaStockCredit = {
  usage: ManhuaStockFootageUsage;
  assetId: string;
  attributionZh: string;
  pageUrl?: string;
  licenseUrl: string;
  /** 空镜所在成片节点 / 场景参考图 id */
  blockId?: string;
  refId?: string;
};

/** 导出署名清单：当前在用的空镜（只认成片就是该空镜的段）+ 场景参考图；按 assetId+用法去重。 */
export function collectManhuaStockCredits(input: {
  clips?: ReadonlyArray<ClipLike & { id: string }>;
  sceneRefs?: ReadonlyArray<{ id: string; stockFootage?: unknown }>;
}): ManhuaStockCredit[] {
  const out: ManhuaStockCredit[] = [];
  const seen = new Set<string>();
  const push = (mark: ManhuaStockFootageMark, extra: { blockId?: string; refId?: string }) => {
    const key = `${mark.usage}:${mark.assetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      usage: mark.usage,
      assetId: mark.assetId,
      attributionZh: mark.attributionZh,
      ...(mark.pageUrl ? { pageUrl: mark.pageUrl } : {}),
      licenseUrl: mark.licenseUrl,
      ...extra,
    });
  };
  for (const clip of input.clips || []) {
    const mark = manhuaStockEmptyShotMarkOf(clip);
    if (mark) push(mark, { blockId: clip.id });
  }
  for (const ref of input.sceneRefs || []) {
    const mark = normalizeManhuaStockFootageMark(ref.stockFootage, "reference");
    if (mark) push(mark, { refId: ref.id });
  }
  return out;
}

export function formatManhuaStockCreditsMarkdown(credits: readonly ManhuaStockCredit[]): string {
  if (!credits.length) return "";
  return [
    "# 图库素材署名",
    "",
    `素材来自 Pexels，按 ${PEXELS_LICENSE.name}（${PEXELS_LICENSE.url}）使用。`,
    "",
    ...credits.map(
      (c) =>
        `- ${c.usage === "empty_shot" ? "空镜·无人物" : "场景参考（未入片）"}：${c.attributionZh}${c.pageUrl ? ` · ${c.pageUrl}` : ""}（${c.assetId}）`,
    ),
    "",
  ].join("\n");
}

type AssembleClipLike = {
  clipUrl?: string;
  trimInSec?: number;
  trimOutSec?: number;
  shotPieces?: PieceLike[];
};

/**
 * 成片坞 → 合成入参：本段成片就是图库空镜时，带上 stockAssetId（服务端据此核对归属/用法/时长并现签），
 * 裁点收进登记窗口（细剪没动过则取登记裁点）。不是空镜的段原样返回，且绝不带 stockAssetId。
 */
export function withManhuaStockEmptyShotAssemble<C extends AssembleClipLike>(
  clip: C,
  block: ClipLike | undefined,
): C & { stockAssetId?: string } {
  const { stockAssetId: _ignored, ...rest } = clip as C & { stockAssetId?: unknown };
  const base = rest as C;
  if (!block) return base;
  const mark = manhuaStockEmptyShotMarkOf(block);
  const window = manhuaStockEmptyShotWindowOf(block);
  if (!mark || !window) return base;
  const hasTrim = typeof base.trimInSec === "number" && typeof base.trimOutSec === "number";
  const clamped = clampManhuaEditTrimToStockWindow(
    {
      inSec: hasTrim ? (base.trimInSec as number) : window.inSec,
      outSec: hasTrim ? (base.trimOutSec as number) : window.outSec,
      ...(base.shotPieces?.length ? { shotPieces: base.shotPieces } : {}),
    },
    window,
  );
  return {
    ...base,
    trimInSec: clamped.inSec,
    trimOutSec: clamped.outSec,
    ...(clamped.shotPieces ? { shotPieces: clamped.shotPieces } : {}),
    stockAssetId: mark.assetId,
  };
}
