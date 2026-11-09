/**
 * 素材面板/抽屉共用的纯逻辑（无 React、无网络），便于在 node 环境单测。
 * - 本机待办：采用前先落盘 requestId，断线/刷新后用同一编号续做（服务端幂等）。
 * - 抽屉展示：时长、画幅、「短于镜头 N 秒」、关键词兜底、最终交给业务方的裁点。
 */
import {
  matchesOrientation,
  type StockFootageAssetView,
  type StockFootageCandidate,
  type StockFootageKind,
  type StockFootageOrientation,
  type StockFootagePurpose,
  type StockFootageUsage,
} from "@shared/stockFootage";
import { clampStockTrim, type StockTrim } from "@shared/stockFootageTrim";

export type StockFootageContext = { projectId?: string; shotId?: string; segmentId?: string; note?: string };

export type PendingAdoption = {
  requestId: string;
  providerAssetId: string;
  kind: StockFootageKind;
  purpose: StockFootagePurpose;
  usage: StockFootageUsage;
  orientation?: StockFootageOrientation;
  context: StockFootageContext;
  previewImageUrl?: string;
  /** 抽屉发起的采用会记下用户选定的裁点，续做成功后按原裁点绑定。 */
  trim?: StockTrim;
  startedAt: number;
  /** 发起采用的登录用户（String(user.id)）；本机待办是浏览器级存储，不带它会把别人的待办显示给同一台机器上的下一位用户。 */
  ownerKey?: string;
};

export const PENDING_KEY = "mvs.stockFootage.pending.v1";
export const PENDING_MAX_AGE_MS = 7 * 24 * 3600_000;
export const PENDING_MAX_ITEMS = 50;
/** 刚发起的采用由发起方自己收尾；这段时间内不去查询状态，避免与占位抢跑得到「没有找到」的误报。 */
export const PENDING_FRESH_MS = 2 * 60_000;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readPending(storage: StorageLike | undefined = defaultStorage(), now = Date.now()): PendingAdoption[] {
  try {
    const raw = storage?.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as PendingAdoption[]) : [];
    return Array.isArray(list) ? list.filter(p => p && p.requestId && now - p.startedAt < PENDING_MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

export function writePending(list: PendingAdoption[], storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify(list.slice(-PENDING_MAX_ITEMS)));
  } catch {
    /* 存储不可用时仅失去本机续做提示，服务端回执仍在 */
  }
}

export function isFreshPending(p: Pick<PendingAdoption, "startedAt">, now = Date.now()): boolean {
  return now - p.startedAt < PENDING_FRESH_MS;
}

/**
 * 待办是否属于当前登录用户：带 ownerKey 的只给同一用户看；旧版（无 ownerKey）待办为兼容仍显示，7 天后自然过期。
 * 当前用户未知（尚未登录/身份未加载）时不显示任何带主人的待办。
 */
export function pendingBelongsTo(p: Pick<PendingAdoption, "ownerKey">, ownerKey: string | undefined): boolean {
  if (!p.ownerKey) return true;
  return Boolean(ownerKey) && p.ownerKey === ownerKey;
}

/** 抽屉只续做「同一用途 + 同一项目/镜头/段落」的待办，避免把别的镜头的素材绑到当前镜头。 */
export function pendingMatchesContext(p: PendingAdoption, purpose: StockFootagePurpose, context?: StockFootageContext): boolean {
  if (p.purpose !== purpose) return false;
  const c = context ?? {};
  return (p.context?.projectId ?? "") === (c.projectId ?? "") && (p.context?.shotId ?? "") === (c.shotId ?? "") && (p.context?.segmentId ?? "") === (c.segmentId ?? "");
}

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export function fmtDuration(sec?: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}秒`;
}

/** 裁点显示：保留一位小数（拖柄步长 0.1 秒）。 */
export function fmtSec(sec: number): string {
  const v = Math.round(sec * 10) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}秒`;
}

export function orientationLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "";
  const ratio = width / height;
  if (ratio > 1.1) return "横屏";
  if (ratio < 0.9) return "竖屏";
  return "方形";
}

/** 候选比镜头短多少秒（视频才算；照片或无时长返回 0）。保留一位小数，向上取，免得 0.04 秒显示成 0。 */
export function candidateShortBySec(c: { kind: StockFootageKind; durationSec?: number }, targetSec?: number): number {
  if (c.kind !== "video" || !targetSec || !c.durationSec) return 0;
  const short = clampStockTrim({ sourceSec: c.durationSec, targetSec }).shortBySec;
  return short > 0 ? Math.ceil(short * 10 - 1e-9) / 10 : 0;
}

/** 「至少 N 秒」筛选默认值：向下取整到整秒（搜索接口只收整数，1–600），无目标时不限。 */
export function defaultMinDurationSec(targetSec?: number): number | undefined {
  if (!targetSec || !Number.isFinite(targetSec) || targetSec < 1) return undefined;
  return Math.min(600, Math.floor(targetSec));
}

/** 关键词生成失败时退回镜头/段落原文：压缩空白并截到搜索接口上限 100 字。 */
export function fallbackQueryFromText(text?: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 100).trim();
}

/** 关键词接口的输入原文（1–1000 字），无内容时返回空串表示不调用。 */
/** 关键词原文上限：suggestKeywords 是 GET 查询且会被批量合并，中文 URL 编码约 9 倍，过长会撞 431。 */
export const KEYWORD_SOURCE_MAX_CHARS = 300;
export function keywordSourceText(text?: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, KEYWORD_SOURCE_MAX_CHARS);
}

export const STOCK_PHOTO_DEFAULT_SEC = 3;

/**
 * 采用成功后交给业务方的裁点：照片固定 0 → 目标时长（缺省 3 秒）；
 * 视频以资产实测时长再夹一次，防止候选元数据与入库文件不一致导致越界。
 */
export function buildStockPick(asset: StockFootageAssetView, trim: StockTrim | undefined, targetSec?: number): { asset: StockFootageAssetView; inSec: number; outSec: number } {
  if (asset.kind === "photo") return { asset, inSec: 0, outSec: targetSec && targetSec > 0 ? targetSec : STOCK_PHOTO_DEFAULT_SEC };
  const sourceSec = asset.durationSec ?? (trim ? trim.outSec : 0);
  // 时长未知的视频（元数据缺失）：只能按镜头时长从头取，交由下游按实际文件再夹。
  if (!(sourceSec > 0)) return { asset, inSec: 0, outSec: targetSec && targetSec > 0 ? targetSec : 0 };
  const windowSec = trim ? trim.outSec - trim.inSec : targetSec;
  const clamped = clampStockTrim({ sourceSec, targetSec: windowSec && windowSec > 0 ? windowSec : undefined, inSec: trim?.inSec ?? 0 });
  return { asset, inSec: clamped.inSec, outSec: clamped.outSec };
}

// ── 抽屉流程（11-09 用户反馈「看了都不会用」「要 18 个候选吗」后的改版）──

/** 一屏候选数：够挑又不用翻滚；要更多按「换一批」。 */
export const STOCK_DRAWER_PER_PAGE = 6;

export type StockDrawerStep = 1 | 2 | 3;
export const STOCK_DRAWER_STEPS: ReadonlyArray<{ step: StockDrawerStep; label: string; hint: string }> = [
  { step: 1, label: "定关键词", hint: "已按镜头描述自动生成并开始搜索，不合适可改词再搜" },
  { step: 2, label: "挑一个候选", hint: "点卡片即预览；带「合适」标记的时长与画幅都够" },
  { step: 3, label: "调选段并采用", hint: "拖入点选取素材哪一秒开始，确认后才替换当前画面" },
];

/** 当前所处步骤：没结果=①，有结果没选=②，已选=③。 */
export function stockDrawerStep(input: { hasQuery: boolean; hasCandidates: boolean; hasSelected: boolean }): StockDrawerStep {
  if (input.hasSelected) return 3;
  if (input.hasQuery && input.hasCandidates) return 2;
  return 1;
}

/** 使用指南：面向第一次打开的人，三句话说清这扇抽屉做什么、怎么用、采用后去了哪。 */
export const STOCK_DRAWER_GUIDE: ReadonlyArray<string> = [
  "这里从公开图库为当前镜头/段落找实拍画面，不会生成、不扣积分；采用后素材会保存到你的空间并绑定到这一段。",
  "关键词已按描述自动生成并搜索；想换角度就改词再搜，中文词也可以。",
  "点一张候选即预览；视频可拖「入点」决定从素材哪一秒开始，选段长度默认等于镜头时长。",
  "按下方「采用到…」才会替换当前画面；不满意随时再开抽屉换一张，已采用的素材可在「我的素材」里复用。",
];

export const STOCK_DRAWER_GUIDE_SEEN_KEY = "mvs.stockFootage.guideSeen.v1";

/** 主按钮文案：从标题推导目标，推不出退回传入的默认文案。 */
export function stockDrawerConfirmLabel(title: string, fallback = "采用并绑定"): string {
  const t = (title ?? "").replace(/\s+/g, "");
  let m = t.match(/^为镜头(\d+)/);
  if (m) return `采用到镜头 ${m[1]}`;
  m = t.match(/^为口播第(\d+)段/);
  if (m) return `采用到口播第 ${m[1]} 段`;
  m = t.match(/^为第(\d+)段/);
  if (m) return `采用到第 ${m[1]} 段`;
  if (/场景找参考图/.test(t)) return "采用为场景参考";
  return fallback;
}

/** 候选排序：时长够且画幅符合的排前面（稳定排序，不丢任何候选），其余保持接口顺序。 */
export function rankStockCandidates<T extends { kind: StockFootageKind; durationSec?: number; width: number; height: number }>(
  list: readonly T[],
  targetSec?: number,
  wantOrientation?: StockFootageOrientation,
): Array<T & { fit: boolean }> {
  const fitOf = (c: T) => {
    const longEnough = candidateShortBySec(c, targetSec) === 0;
    const shape = orientationLabel(c.width, c.height);
    const want = wantOrientation === "landscape" ? "横屏" : wantOrientation === "portrait" ? "竖屏" : wantOrientation === "square" ? "方形" : "";
    const shapeOk = !want || shape === want;
    return longEnough && shapeOk;
  };
  const withFit = list.map((c, i) => ({ c, i, fit: fitOf(c) }));
  withFit.sort((a, b) => (a.fit === b.fit ? a.i - b.i : a.fit ? -1 : 1));
  return withFit.map(x => ({ ...x.c, fit: x.fit }));
}

// ── 「我已采用过的」复用（四端共用）──

/**
 * 已采用资产 → 抽屉候选形状：预览直接用本人资产的签名读链（照片当图、视频当预览），
 * 与搜索候选共用选中/裁点/确认链；确认时命中 adoptedByKey 直接绑定，不再发起保存。
 */
export function adoptedAssetToCandidate(asset: StockFootageAssetView): StockFootageCandidate {
  return {
    provider: asset.source.provider,
    providerAssetId: asset.source.providerAssetId,
    kind: asset.kind,
    pageUrl: asset.source.pageUrl,
    previewImageUrl: asset.kind === "photo" ? asset.url : "",
    ...(asset.kind === "video" ? { previewVideoUrl: asset.url } : {}),
    width: asset.width,
    height: asset.height,
    ...(asset.durationSec ? { durationSec: asset.durationSec } : {}),
    author: asset.source.author,
  };
}

/**
 * 只复用与当前位置同类型、同用法、画幅相符的已采用资产（视频还须带时长，否则没法裁）。
 * 画幅：采用时服务端按当时的画幅偏好挑文件，同一 providerAssetId 的横/竖版是不同文件，不能跨画幅复用。
 */
export function reusableAdoptedAssets(
  list: readonly StockFootageAssetView[] | undefined,
  kind: "video" | "photo",
  usage: StockFootageUsage,
  orientation?: StockFootageOrientation,
): StockFootageAssetView[] {
  return (list ?? []).filter(
    a => a.kind === kind && a.usage === usage && (kind !== "video" || (a.durationSec ?? 0) > 0) && matchesOrientation(a.width, a.height, orientation)
  );
}
