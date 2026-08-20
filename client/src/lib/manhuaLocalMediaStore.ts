/**
 * 漫剧画布本机媒体库（IndexedDB）。
 * 签名 HTTPS 约 7 天过期；出图后把二进制落入本机，草稿只记 local-media: 指针，
 * 打开时优先从本机目录取，不再只靠远端签名链。
 */

import type { CanvasBlock } from "@/lib/canvasTypes";

export const LOCAL_MEDIA_PTR_PREFIX = "local-media:v1/";
export const MANHUA_LOCAL_MEDIA_DB = "mv-manhua-local-media-v1";
export const MANHUA_LOCAL_MEDIA_STORE = "media";

export type ManhuaLocalMediaSlot =
  | "output"
  | "ref"
  | `out:${number}`
  | `fusion:${number}`;

export type ManhuaLocalMediaRecord = {
  id: string;
  blockId: string;
  slot: ManhuaLocalMediaSlot;
  blob: Blob;
  mime: string;
  /** 写入时的远端/站点 URL（可能已过期，仅供溯源） */
  sourceUrl: string;
  updatedAt: number;
};

type MemoryBackend = {
  kind: "memory";
  map: Map<string, ManhuaLocalMediaRecord>;
};

type IdbBackend = {
  kind: "idb";
  db: IDBDatabase;
};

type StoreBackend = MemoryBackend | IdbBackend;

/** blob:/local-media: → 溯源 URL（云同步用） */
const displayToSourceUrl = new Map<string, string>();
/** blob: → local-media 指针（本机落盘用） */
const displayToPointer = new Map<string, string>();
/** sourceUrl → local-media 指针 */
const sourceToPointer = new Map<string, string>();

let backendPromise: Promise<StoreBackend> | null = null;
let cacheQueue: Promise<void> = Promise.resolve();

export function isLocalMediaPointer(u: unknown): boolean {
  return String(u || "").trim().startsWith(LOCAL_MEDIA_PTR_PREFIX);
}

export function localMediaPointerId(pointer: string): string {
  return String(pointer || "").trim().slice(LOCAL_MEDIA_PTR_PREFIX.length);
}

export function makeLocalMediaPointer(recordId: string): string {
  return `${LOCAL_MEDIA_PTR_PREFIX}${recordId}`;
}

export function makeLocalMediaRecordId(blockId: string, slot: ManhuaLocalMediaSlot): string {
  return `${String(blockId || "").trim()}::${slot}`;
}

export function rememberLocalMediaDisplay(input: {
  displayUrl: string;
  pointer: string;
  sourceUrl?: string;
}): void {
  const displayUrl = String(input.displayUrl || "").trim();
  const pointer = String(input.pointer || "").trim();
  if (!displayUrl || !isLocalMediaPointer(pointer)) return;
  displayToPointer.set(displayUrl, pointer);
  const source = String(input.sourceUrl || "").trim();
  if (source) {
    displayToSourceUrl.set(displayUrl, source);
    sourceToPointer.set(source, pointer);
  }
  displayToSourceUrl.set(pointer, source || displayToSourceUrl.get(pointer) || "");
}

/** 云草稿序列化：blob:/local-media: → 仍可用的 https/相对路径（若有） */
export function resolveUrlForCloudSync(url: unknown): string | undefined {
  const s = String(url || "").trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s) || s.startsWith("/manhua-") || s.startsWith("/assets/") || s.startsWith("/demo/")) {
    return s;
  }
  if (s.startsWith("blob:") || isLocalMediaPointer(s)) {
    const source = displayToSourceUrl.get(s);
    if (source && (/^https?:\/\//i.test(source) || source.startsWith("/"))) return source;
  }
  return undefined;
}

/** 本机 JSON 落盘：blob: → local-media:；已是指针则保留 */
export function resolveUrlForLocalPersist(url: unknown): string | undefined {
  const s = String(url || "").trim();
  if (!s) return undefined;
  if (isLocalMediaPointer(s)) return s;
  if (s.startsWith("blob:")) {
    return displayToPointer.get(s);
  }
  const fromSource = sourceToPointer.get(s);
  if (fromSource) return fromSource;
  if (/^https?:\/\//i.test(s) || s.startsWith("/manhua-") || s.startsWith("/assets/") || s.startsWith("/demo/")) {
    return s;
  }
  return undefined;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(MANHUA_LOCAL_MEDIA_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MANHUA_LOCAL_MEDIA_STORE)) {
        db.createObjectStore(MANHUA_LOCAL_MEDIA_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
  });
}

async function getBackend(): Promise<StoreBackend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        const db = await openIdb();
        return { kind: "idb", db } satisfies IdbBackend;
      } catch {
        return { kind: "memory", map: new Map() } satisfies MemoryBackend;
      }
    })();
  }
  return backendPromise;
}

/** 测试用：注入内存后端并清空映射 */
export async function __resetManhuaLocalMediaStoreForTests(): Promise<void> {
  displayToSourceUrl.clear();
  displayToPointer.clear();
  sourceToPointer.clear();
  backendPromise = Promise.resolve({ kind: "memory", map: new Map() });
  cacheQueue = Promise.resolve();
}

async function idbPut(db: IDBDatabase, record: ManhuaLocalMediaRecord): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MANHUA_LOCAL_MEDIA_STORE, "readwrite");
    tx.objectStore(MANHUA_LOCAL_MEDIA_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("idb put failed"));
  });
}

async function idbGet(db: IDBDatabase, id: string): Promise<ManhuaLocalMediaRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANHUA_LOCAL_MEDIA_STORE, "readonly");
    const req = tx.objectStore(MANHUA_LOCAL_MEDIA_STORE).get(id);
    req.onsuccess = () => resolve((req.result as ManhuaLocalMediaRecord) || null);
    req.onerror = () => reject(req.error || new Error("idb get failed"));
  });
}

export async function putLocalMediaRecord(record: ManhuaLocalMediaRecord): Promise<string> {
  const backend = await getBackend();
  if (backend.kind === "memory") {
    backend.map.set(record.id, record);
  } else {
    await idbPut(backend.db, record);
  }
  const pointer = makeLocalMediaPointer(record.id);
  sourceToPointer.set(record.sourceUrl, pointer);
  displayToSourceUrl.set(pointer, record.sourceUrl);
  return pointer;
}

export async function getLocalMediaRecord(recordId: string): Promise<ManhuaLocalMediaRecord | null> {
  const id = String(recordId || "").trim();
  if (!id) return null;
  const backend = await getBackend();
  if (backend.kind === "memory") return backend.map.get(id) || null;
  return idbGet(backend.db, id);
}

async function fetchUrlAsBlob(url: string): Promise<Blob | null> {
  const trimmed = String(url || "").trim();
  if (!trimmed || trimmed.startsWith("blob:") || isLocalMediaPointer(trimmed)) return null;
  try {
    const res = await fetch(trimmed, {
      mode: trimmed.startsWith("/") ? "same-origin" : "cors",
      // 站内受保护媒体(/api/canvas-media/)需要登录 Cookie;跨域仍不带凭据
      credentials: trimmed.startsWith("/") ? "include" : "omit",
      cache: "force-cache",
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) return blob;
    }
  } catch {
    /* try element fallback */
  }
  if (typeof Image === "undefined" || typeof document === "undefined") return null;
  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = window.setTimeout(() => resolve(null), 12_000);
      img.onload = () => {
        window.clearTimeout(timer);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          if (!canvas.width || !canvas.height) {
            resolve(null);
            return;
          }
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      img.src = trimmed;
    });
    return blob;
  } catch {
    return null;
  }
}

function shouldCacheBlock(b: CanvasBlock): boolean {
  const id = String(b.id || "");
  if (b.kind === "video") return false;
  if (/^(clip|omni_edit)-/i.test(id)) return false;
  return (
    id.startsWith("keyart-") ||
    id.startsWith("charsheet-") ||
    id.startsWith("sceneplate-") ||
    id.startsWith("propplate-") ||
    id.startsWith("propsheet-") ||
    id.startsWith("prop-") ||
    id.startsWith("wardrobe") ||
    b.kind === "image"
  );
}

async function cacheOne(
  blockId: string,
  slot: ManhuaLocalMediaSlot,
  url: string,
): Promise<string | null> {
  const sourceUrl = String(url || "").trim();
  if (!sourceUrl) return null;
  if (isLocalMediaPointer(sourceUrl)) return sourceUrl;
  if (sourceUrl.startsWith("blob:")) {
    return displayToPointer.get(sourceUrl) || null;
  }
  const existingPtr = sourceToPointer.get(sourceUrl);
  if (existingPtr) {
    const rec = await getLocalMediaRecord(localMediaPointerId(existingPtr));
    if (rec?.blob?.size) return existingPtr;
  }
  const recordId = makeLocalMediaRecordId(blockId, slot);
  const prior = await getLocalMediaRecord(recordId);
  if (prior?.blob?.size && prior.sourceUrl === sourceUrl) {
    const pointer = makeLocalMediaPointer(recordId);
    sourceToPointer.set(sourceUrl, pointer);
    displayToSourceUrl.set(pointer, sourceUrl);
    return pointer;
  }
  const blob = await fetchUrlAsBlob(sourceUrl);
  if (!blob || !blob.size) return null;
  const pointer = await putLocalMediaRecord({
    id: recordId,
    blockId,
    slot,
    blob,
    mime: blob.type || "image/jpeg",
    sourceUrl,
    updatedAt: Date.now(),
  });
  return pointer;
}

/**
 * 把可缓存静帧/定妆等远端图写入本机媒体库。
 * 不改传入数组；调用方随后可用 applyLocalMediaPointersToBlocks。
 */
export async function cacheCanvasMediaToLocalStore(blocks: CanvasBlock[]): Promise<{
  cached: number;
  failed: number;
}> {
  let cached = 0;
  let failed = 0;
  for (const b of blocks) {
    if (!shouldCacheBlock(b)) continue;
    const blockId = String(b.id || "");
    const jobs: Array<{ slot: ManhuaLocalMediaSlot; url: string }> = [];
    if (b.outputUrl) jobs.push({ slot: "output", url: b.outputUrl });
    (b.outputUrls || []).forEach((u, i) => {
      if (u && u !== b.outputUrl) jobs.push({ slot: `out:${i}`, url: u });
    });
    if (b.refImageUrl) jobs.push({ slot: "ref", url: b.refImageUrl });
    (b.editFusionUrls || []).forEach((u, i) => {
      if (u) jobs.push({ slot: `fusion:${i}`, url: u });
    });
    for (const job of jobs) {
      const u = String(job.url || "").trim();
      if (!u || u.startsWith("blob:") || isLocalMediaPointer(u)) continue;
      if (
        !/^https?:\/\//i.test(u) &&
        !u.startsWith("/manhua-") &&
        !u.startsWith("/assets/") &&
        !u.startsWith("/api/canvas-media/")
      ) {
        continue;
      }
      const ptr = await cacheOne(blockId, job.slot, u);
      if (ptr) cached += 1;
      else failed += 1;
    }
  }
  return { cached, failed };
}

export function scheduleCacheCanvasMediaToLocalStore(blocks: CanvasBlock[]): void {
  const snapshot = blocks.map((b) => ({ ...b, outputUrls: [...(b.outputUrls || [])] }));
  cacheQueue = cacheQueue
    .then(() => cacheCanvasMediaToLocalStore(snapshot))
    .then(() => undefined)
    .catch(() => undefined);
}

export async function resolvePointerToDisplayUrl(pointer: string): Promise<string | null> {
  if (!isLocalMediaPointer(pointer)) return null;
  const rec = await getLocalMediaRecord(localMediaPointerId(pointer));
  if (!rec?.blob?.size) return null;
  const displayUrl = URL.createObjectURL(rec.blob);
  rememberLocalMediaDisplay({
    displayUrl,
    pointer,
    sourceUrl: rec.sourceUrl,
  });
  return displayUrl;
}

/** 远端 403/过期时：按 blockId 槽位从本机目录取显示 URL */
export async function tryLocalMediaDisplayForBlock(
  blockId: string,
  slot: ManhuaLocalMediaSlot = "output",
): Promise<string | null> {
  const pointer = makeLocalMediaPointer(makeLocalMediaRecordId(blockId, slot));
  return resolvePointerToDisplayUrl(pointer);
}

async function resolveAnyToDisplayUrl(url: string): Promise<string> {
  const s = String(url || "").trim();
  if (!s) return s;
  if (s.startsWith("blob:")) return s;
  if (isLocalMediaPointer(s)) {
    return (await resolvePointerToDisplayUrl(s)) || s;
  }
  const ptr = sourceToPointer.get(s);
  if (ptr) {
    const display = await resolvePointerToDisplayUrl(ptr);
    if (display) return display;
  }
  // 已按稳定 id 缓存过则直接取
  return s;
}

/** 打开草稿：local-media: / 已缓存 https → blob: 显示 URL */
export async function rehydrateBlocksFromLocalMedia(blocks: CanvasBlock[]): Promise<CanvasBlock[]> {
  const out: CanvasBlock[] = [];
  for (const b of blocks) {
    if (!shouldCacheBlock(b)) {
      out.push(b);
      continue;
    }
    let changed = false;
    let outputUrl = b.outputUrl;
    let refImageUrl = b.refImageUrl;
    let outputUrls = b.outputUrls;
    let editFusionUrls = b.editFusionUrls;

    if (outputUrl) {
      const next = await resolveAnyToDisplayUrl(outputUrl);
      if (next !== outputUrl) {
        outputUrl = next;
        changed = true;
      }
    }
    if (refImageUrl) {
      const next = await resolveAnyToDisplayUrl(refImageUrl);
      if (next !== refImageUrl) {
        refImageUrl = next;
        changed = true;
      }
    }
    if (outputUrls?.length) {
      const nextList: string[] = [];
      for (const u of outputUrls) {
        const next = await resolveAnyToDisplayUrl(u);
        if (next !== u) changed = true;
        nextList.push(next);
      }
      outputUrls = nextList;
    }
    if (editFusionUrls?.length) {
      const nextList: string[] = [];
      for (const u of editFusionUrls) {
        const next = await resolveAnyToDisplayUrl(u);
        if (next !== u) changed = true;
        nextList.push(next);
      }
      editFusionUrls = nextList;
    }

    // 仅有远端 https 时尝试从本机 id 回灌（source 映射尚未建）
    if (!changed && outputUrl && /^https?:\/\//i.test(outputUrl)) {
      const ptr = makeLocalMediaPointer(makeLocalMediaRecordId(b.id, "output"));
      const display = await resolvePointerToDisplayUrl(ptr);
      if (display) {
        rememberLocalMediaDisplay({ displayUrl: display, pointer: ptr, sourceUrl: outputUrl });
        outputUrl = display;
        changed = true;
      }
    }

    out.push(
      changed
        ? {
            ...b,
            outputUrl,
            refImageUrl,
            outputUrls: outputUrls || [],
            editFusionUrls,
          }
        : b,
    );
  }
  return out;
}

/** 本机落盘前：把已缓存槽位改成 local-media: 指针，避免 LS 只剩过期 https */
export function applyLocalMediaPointersToBlocks(blocks: CanvasBlock[]): CanvasBlock[] {
  return blocks.map((b) => {
    if (!shouldCacheBlock(b)) return b;
    const mapUrl = (u: unknown): string | undefined => {
      const s = String(u || "").trim();
      if (!s) return undefined;
      return resolveUrlForLocalPersist(s) || (isLocalMediaPointer(s) ? s : undefined) ||
        (/^https?:\/\//i.test(s) || s.startsWith("/manhua-") || s.startsWith("/assets/")
          ? s
          : undefined);
    };

    const outputUrl = mapUrl(b.outputUrl);
    const refImageUrl = mapUrl(b.refImageUrl);
    const outputUrls = (b.outputUrls || []).map((u) => mapUrl(u) || "").filter(Boolean);
    const editFusionUrls = (b.editFusionUrls || []).map((u) => mapUrl(u) || "").filter(Boolean);

    return {
      ...b,
      outputUrl,
      refImageUrl,
      outputUrls,
      editFusionUrls: editFusionUrls.length ? editFusionUrls : undefined,
    };
  });
}
