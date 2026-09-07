/**
 * 漫剧画布本机媒体库（IndexedDB）。
 * 签名 HTTPS 约 7 天过期；出图后把二进制落入本机，草稿只记 local-media: 指针，
 * 打开时优先从本机目录取，不再只靠远端签名链。
 */

import type { CanvasBlock } from "@/lib/canvasTypes";
import { remapManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";

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
  testOnly?: boolean;
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

/** 新记录按来源分版本；同节点重出不能覆盖旧指针的字节。旧槽位记录只读兼容。 */
async function sourceRecordId(sourceUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceUrl));
  return `source-sha256-${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
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
    const pointer = displayToPointer.get(s);
    const source = displayToSourceUrl.get(s);
    return pointer && source === displayToSourceUrl.get(pointer) ? pointer : source;
  }
  const fromSource = sourceToPointer.get(s);
  if (fromSource && displayToSourceUrl.get(fromSource) === s) return fromSource;
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
export async function __resetManhuaLocalMediaStoreForTests(options?: { keepRecords?: boolean }): Promise<void> {
  displayToSourceUrl.clear();
  displayToPointer.clear();
  sourceToPointer.clear();
  if (!options?.keepRecords) backendPromise = Promise.resolve({ kind: "memory", map: new Map(), testOnly: true });
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

/** 导出可直接取已缓存字节；页面刷新丢失内存映射后仍按原来源查找。 */
export async function getLocalMediaRecordBySource(sourceUrl: string): Promise<ManhuaLocalMediaRecord | null> {
  const source = String(sourceUrl || "").trim();
  if (!source) return null;
  if (isLocalMediaPointer(source)) return getLocalMediaRecord(localMediaPointerId(source));
  const remembered = sourceToPointer.get(source) || displayToPointer.get(source);
  if (remembered) {
    const record = await getLocalMediaRecord(localMediaPointerId(remembered));
    if (record?.blob?.size && (record.sourceUrl === source || displayToSourceUrl.get(source) === record.sourceUrl)) return record;
  }
  const record = await getLocalMediaRecord(await sourceRecordId(source));
  return record?.blob?.size && record.sourceUrl === source ? record : null;
}

export type ManhuaBackupMediaInput = { sourceUrl: string; blob: Blob; mime: string; gcsUri?: string };

async function mediaBytesHash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** 确认后一次性导入；来源可重建、同源不同字节拒绝，事务失败不留下半包新记录。 */
export async function importLocalMediaRecords(inputs: ManhuaBackupMediaInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const backend = await getBackend();
  if (backend.kind === "memory" && !backend.testOnly) {
    throw new Error("浏览器本机存储不可用，尚未恢复工作区，请保留备份文件");
  }
  const records = new Map<string, { record: ManhuaLocalMediaRecord; hash: string }>();
  const originalSources = new Set<string>();
  for (const input of inputs) {
    const originalSource = String(input.sourceUrl || "").trim();
    if (!originalSource || !input.blob?.size) throw new Error("备份图片缺少来源或内容，尚未恢复工作区");
    originalSources.add(originalSource);
    const hash = await mediaBytesHash(input.blob);
    // 长期身份也在同一事务中保存；签名刷新后仍可读同一图片，不改草稿地址。
    const sources = new Set([originalSource]);
    if (input.gcsUri?.startsWith("gs://")) sources.add(input.gcsUri.trim());
    for (const sourceUrl of Array.from(sources)) {
      const id = await sourceRecordId(sourceUrl);
      const previous = records.get(id);
      if (previous && previous.hash !== hash) throw new Error("备份中同一图片来源对应不同内容，尚未恢复工作区");
      records.set(id, { hash, record: { id, blockId: "backup-import", slot: "output", blob: input.blob, mime: input.mime || input.blob.type || "image/png", sourceUrl, updatedAt: Date.now() } });
    }
  }
  const additions: ManhuaLocalMediaRecord[] = [];
  for (const { record, hash } of Array.from(records.values())) {
    const existing = await getLocalMediaRecord(record.id);
    if (existing) {
      if (existing.sourceUrl !== record.sourceUrl || await mediaBytesHash(existing.blob) !== hash) {
        throw new Error("本机已有同一来源的不同图片，已保留原记录，尚未恢复工作区");
      }
    } else additions.push(record);
  }
  if (backend.kind === "memory") {
    // 测试后端与事务的新增语义一致，不覆盖已存在的记录。
    if (additions.some((record) => backend.map.has(record.id))) throw new Error("本机图片缓存已变化，请重新导入");
    for (const record of additions) backend.map.set(record.id, record);
  } else if (additions.length) {
    await new Promise<void>((resolve, reject) => {
      const tx = backend.db.transaction(MANHUA_LOCAL_MEDIA_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error("备份图片写入失败，尚未恢复工作区"));
      tx.onabort = () => reject(new Error("备份图片写入已撤销，尚未恢复工作区"));
      try {
        const store = tx.objectStore(MANHUA_LOCAL_MEDIA_STORE);
        for (const record of additions) store.add(record);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  // 只有持久事务成功后才发布内存映射，失败不宣称可以恢复。
  for (const { record } of Array.from(records.values())) {
    const pointer = makeLocalMediaPointer(record.id);
    sourceToPointer.set(record.sourceUrl, pointer);
    displayToSourceUrl.set(pointer, record.sourceUrl);
  }
  return originalSources.size;
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
    if (rec?.blob?.size && rec.sourceUrl === sourceUrl) return existingPtr;
  }
  const recordId = await sourceRecordId(sourceUrl);
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

/** 远端失效时按当前图片来源恢复；不能拿同节点的另一版充数。 */
export async function tryLocalMediaDisplayForBlock(
  blockId: string,
  slot: ManhuaLocalMediaSlot = "output",
  expectedUrl?: string,
): Promise<string | null> {
  const source = String(expectedUrl || "").trim();
  if (!source) return null;
  if (isLocalMediaPointer(source)) return resolvePointerToDisplayUrl(source);
  if (source.startsWith("blob:")) return null;
  const remembered = sourceToPointer.get(source);
  const ids = [
    ...(remembered ? [localMediaPointerId(remembered)] : []),
    await sourceRecordId(source),
    makeLocalMediaRecordId(blockId, slot),
  ];
  for (const id of ids) {
    const record = await getLocalMediaRecord(id);
    if (record?.blob?.size && record.sourceUrl === source) {
      return resolvePointerToDisplayUrl(makeLocalMediaPointer(id));
    }
  }
  return null;
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
    const record = await getLocalMediaRecord(localMediaPointerId(ptr));
    if (record?.sourceUrl === s) {
      const display = await resolvePointerToDisplayUrl(ptr);
      if (display) return display;
    }
  }
  const stored = await getLocalMediaRecord(await sourceRecordId(s));
  if (stored?.sourceUrl === s && stored.blob?.size) {
    return (await resolvePointerToDisplayUrl(makeLocalMediaPointer(stored.id))) || s;
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
      const display = await tryLocalMediaDisplayForBlock(b.id, "output", outputUrl);
      if (display) {
        outputUrl = display;
        changed = true;
      }
    }

    out.push(
      changed
        ? {
            ...b,
            outputUrl,
            manhuaKeyartLookState: remapManhuaKeyartLookOutput(b, outputUrl),
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
      manhuaKeyartLookState: remapManhuaKeyartLookOutput(b, outputUrl),
      refImageUrl,
      outputUrls,
      editFusionUrls: editFusionUrls.length ? editFusionUrls : undefined,
    };
  });
}
