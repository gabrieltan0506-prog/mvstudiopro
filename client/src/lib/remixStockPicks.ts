/**
 * 爆款复刻 · 视频分镜「找素材」的本机记录。
 *
 * 范围：找素材 → 服务端把素材存进本人空间（purpose=remix, usage=insert）→ 这里只记「哪一段采用了哪些素材、取了哪几秒」，
 * 供页面刷新后继续显示缩略图；用户自己剪，不接成片 / 导出链路。
 *
 * - 单一本机键 `mvs.remix.stockPicks.v1`，内部按用户 id 分桶：换账号登录不串台。
 * - 不保存签名读地址（会过期），只存 assetId / gcsUri 等稳定字段；预览地址每次由 listAdoptions 重新签。
 * - 读到坏数据不抛错：整体解析失败 → 空；单条不合格 → 丢弃该条，其余保留。
 */
import { z } from "zod";
import type { StockFootageAssetView } from "@shared/stockFootage";

export const REMIX_STOCK_PICKS_KEY = "mvs.remix.stockPicks.v1";

export const remixStockPickSchema = z
  .object({
    assetId: z.string().regex(/^sf_[0-9a-f]{48}$/),
    requestId: z.string().uuid(),
    kind: z.enum(["video", "photo"]),
    gcsUri: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** 素材整体时长（秒，视频）。 */
    durationSec: z.number().positive().optional(),
    inSec: z.number().min(0),
    outSec: z.number().min(0),
    adoptedAt: z.string(),
  })
  .strict();
export type RemixStockPick = z.infer<typeof remixStockPickSchema>;

/** 段序号（"1".."4"）→ 该段已采用的素材列表。 */
export type RemixStockPicksBySegment = Record<string, RemixStockPick[]>;

const storeSchema = z
  .object({
    version: z.literal(1),
    users: z.record(z.string(), z.record(z.string(), z.array(z.unknown()))),
  })
  .strict();

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * 分镜时间段长度："00:02-00:06" → 4。支持 mm:ss 与 hh:mm:ss，分隔符接受 - – — ~。
 * 解析不了、顺序颠倒或长度为 0 → undefined（抽屉不设目标时长，不冒充）。
 */
export function parseSegmentDurationSec(range: string): number | undefined {
  const m = String(range || "").trim().match(/^(\d{1,2}(?::\d{1,2}){1,2})\s*[-–—~]\s*(\d{1,2}(?::\d{1,2}){1,2})$/);
  if (!m) return undefined;
  const start = clockToSec(m[1]);
  const end = clockToSec(m[2]);
  if (start === undefined || end === undefined) return undefined;
  const len = end - start;
  return len > 0 ? len : undefined;
}

function clockToSec(clock: string): number | undefined {
  const parts = clock.split(":").map(p => Number(p));
  if (parts.some(p => !Number.isInteger(p) || p < 0 || p > 59)) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** 抽屉 onPick 的结果 → 可持久化的记录（不带签名地址）。 */
export function remixPickFromAsset(asset: StockFootageAssetView, trim: { inSec: number; outSec: number }, now: () => Date = () => new Date()): RemixStockPick {
  const outSec = asset.durationSec ? Math.min(trim.outSec, asset.durationSec) : trim.outSec;
  return remixStockPickSchema.parse({
    assetId: asset.assetId,
    requestId: asset.requestId,
    kind: asset.kind,
    gcsUri: asset.gcsUri,
    width: asset.width,
    height: asset.height,
    ...(asset.durationSec ? { durationSec: asset.durationSec } : {}),
    inSec: Math.max(0, Math.round(trim.inSec * 10) / 10),
    outSec: Math.max(0, Math.round(outSec * 10) / 10),
    adoptedAt: now().toISOString(),
  });
}

/** 一条采用取用的秒数（出点 − 入点，一位小数）。 */
export function remixPickSeconds(pick: Pick<RemixStockPick, "inSec" | "outSec">): number {
  return Math.max(0, Math.round((pick.outSec - pick.inSec) * 10) / 10);
}

/** 某段已采用素材的总秒数。 */
export function remixSegmentSeconds(picks: readonly Pick<RemixStockPick, "inSec" | "outSec">[]): number {
  return Math.round(picks.reduce((sum, p) => sum + remixPickSeconds(p), 0) * 10) / 10;
}

function readStore(storage: StorageLike): z.infer<typeof storeSchema> {
  try {
    const raw = storage.getItem(REMIX_STOCK_PICKS_KEY);
    if (!raw) return { version: 1, users: {} };
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { version: 1, users: {} };
  } catch {
    return { version: 1, users: {} };
  }
}

/** 读某用户的记录；坏条目丢弃、空段落不保留。 */
export function readRemixStockPicks(storage: StorageLike, userId: number | string): RemixStockPicksBySegment {
  const bucket = readStore(storage).users[String(userId)] ?? {};
  const out: RemixStockPicksBySegment = {};
  for (const [segmentId, list] of Object.entries(bucket)) {
    const picks = list.map(item => remixStockPickSchema.safeParse(item)).filter(p => p.success).map(p => p.data!);
    if (picks.length) out[segmentId] = picks;
  }
  return out;
}

/** 写某用户的记录；其他用户的桶原样保留。返回是否写成功（存储满 / 不可用 → false）。 */
export function writeRemixStockPicks(storage: StorageLike, userId: number | string, picks: RemixStockPicksBySegment): boolean {
  const store = readStore(storage);
  const cleaned: Record<string, RemixStockPick[]> = {};
  for (const [segmentId, list] of Object.entries(picks)) if (list.length) cleaned[segmentId] = list;
  const users = { ...store.users };
  if (Object.keys(cleaned).length) users[String(userId)] = cleaned;
  else delete users[String(userId)];
  try {
    storage.setItem(REMIX_STOCK_PICKS_KEY, JSON.stringify({ version: 1, users }));
    return true;
  } catch {
    return false;
  }
}

/** 追加到某段（同一 assetId 同一段只保留一条，后者覆盖前者的入出点）。 */
export function addRemixStockPick(picks: RemixStockPicksBySegment, segmentId: string, pick: RemixStockPick): RemixStockPicksBySegment {
  const existing = (picks[segmentId] ?? []).filter(p => p.assetId !== pick.assetId);
  return { ...picks, [segmentId]: [...existing, pick] };
}

export function removeRemixStockPick(picks: RemixStockPicksBySegment, segmentId: string, assetId: string): RemixStockPicksBySegment {
  const rest = (picks[segmentId] ?? []).filter(p => p.assetId !== assetId);
  const next = { ...picks };
  if (rest.length) next[segmentId] = rest;
  else delete next[segmentId];
  return next;
}
