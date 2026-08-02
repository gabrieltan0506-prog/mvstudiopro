/**
 * 成片出完强制自动下载到本机「下载」文件夹。
 * 云端/草稿不保留成片；页面预览只是临时链，以本机文件为准。
 */

import type { CanvasBlock } from "@/lib/canvasTypes";
import { downloadRemoteFile } from "@/lib/downloadRemoteFile";
import { getBlockEpisodeIndex } from "@/lib/canvasDramaStudio";
import { resolveClipSegmentIndex } from "@shared/manhuaScriptWorkbench";

export const MANHUA_CLIP_AUTO_DL_LS_KEY = "mv-manhua-clip-auto-dl-v1";

/** 用户可见：出片后自动下到本机 */
export const MANHUA_CLIP_AUTO_DOWNLOAD_HINT_ZH =
  "成片出完会自动下载到本机；请以本机文件为准，页面预览会过期，勿当云端存档。";

type AutoDlLedger = Record<string, { blockId: string; at: string }>;

function isClipBlock(b: CanvasBlock): boolean {
  const id = String(b.id || "");
  return id.startsWith("clip-") || (b.kind === "video" && /^(clip|omni_edit)-/i.test(id));
}

function clipOutputHttpUrl(b: CanvasBlock): string {
  const u = String(b.outputUrl || b.outputUrls?.[0] || "").trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

function ledgerKey(url: string): string {
  // 签名参数会变；用去 query 的路径作去重，避免同片反复下
  return String(url || "").trim().split(/[?#]/)[0] || String(url || "").trim();
}

export function readClipAutoDownloadLedger(
  storage: Pick<Storage, "getItem"> = localStorage,
): AutoDlLedger {
  try {
    const raw = storage.getItem(MANHUA_CLIP_AUTO_DL_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AutoDlLedger;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function markClipAutoDownloaded(
  url: string,
  blockId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const key = ledgerKey(url);
  if (!key) return;
  try {
    const next = {
      ...readClipAutoDownloadLedger(storage),
      [key]: { blockId, at: new Date().toISOString() },
    };
    storage.setItem(MANHUA_CLIP_AUTO_DL_LS_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

export type PendingClipAutoDownload = {
  blockId: string;
  url: string;
  episodeIndex: number;
  segmentIndex: number;
  fileNameBase: string;
};

/** 相对上一帧：新出现的成片 https 产物（且账本未记过） */
export function collectPendingClipAutoDownloads(input: {
  prev: CanvasBlock[];
  next: CanvasBlock[];
  seriesTitle?: string;
  storage?: Pick<Storage, "getItem">;
}): PendingClipAutoDownload[] {
  const ledger = readClipAutoDownloadLedger(input.storage);
  const prevById = new Map(input.prev.map((b) => [b.id, b]));
  const title = String(input.seriesTitle || "漫剧").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
  const out: PendingClipAutoDownload[] = [];

  for (const b of input.next) {
    if (!isClipBlock(b)) continue;
    const url = clipOutputHttpUrl(b);
    if (!url) continue;
    const key = ledgerKey(url);
    if (ledger[key]) continue;
    const prev = prevById.get(b.id);
    const prevUrl = prev ? clipOutputHttpUrl(prev) : "";
    // 仅在「新 URL」或「从无到有」时触发；刷新同 URL 不重复下
    if (prevUrl && ledgerKey(prevUrl) === key) continue;
    if (!prevUrl && prev && (prev.status === "done" || clipOutputHttpUrl(prev))) {
      // 上一帧已是同片 done 但 URL 被清掉又回来——若账本无记录仍应下
    }
    const episodeIndex = getBlockEpisodeIndex(b) ?? 1;
    const segmentIndex = Math.max(1, resolveClipSegmentIndex(b.id, b.prompt));
    out.push({
      blockId: b.id,
      url,
      episodeIndex,
      segmentIndex,
      fileNameBase: `${title}-第${String(episodeIndex).padStart(2, "0")}集-第${String(segmentIndex).padStart(2, "0")}段`,
    });
  }
  return out;
}

export type ClipAutoDownloadRunResult = {
  attempted: number;
  ok: number;
  fallback: number;
  failed: number;
};

/**
 * 串行下载（间隔防浏览器拦连下）。已下载的写入账本，刷新不会再下同片。
 */
export async function runPendingClipAutoDownloads(
  pending: PendingClipAutoDownload[],
  opts?: {
    storage?: Pick<Storage, "getItem" | "setItem">;
    download?: typeof downloadRemoteFile;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<ClipAutoDownloadRunResult> {
  const download = opts?.download || downloadRemoteFile;
  const storage = opts?.storage || localStorage;
  const delayMs = opts?.delayMs ?? 700;
  const sleep =
    opts?.sleep ||
    ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));

  let ok = 0;
  let fallback = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i]!;
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    try {
      const r = await download(item.url, item.fileNameBase);
      markClipAutoDownloaded(item.url, item.blockId, storage);
      if (r.via === "blob" && r.ok) ok += 1;
      else fallback += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: pending.length, ok, fallback, failed };
}
