/**
 * 素材面板/抽屉共用的纯逻辑（无 React、无网络），便于在 node 环境单测。
 * - 本机待办：采用前先落盘 requestId，断线/刷新后用同一编号续做（服务端幂等）。
 * - 抽屉展示：时长、画幅、「短于镜头 N 秒」、关键词兜底、最终交给业务方的裁点。
 */
import type {
  StockFootageAssetView,
  StockFootageKind,
  StockFootageOrientation,
  StockFootagePurpose,
  StockFootageUsage,
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
export function keywordSourceText(text?: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
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
