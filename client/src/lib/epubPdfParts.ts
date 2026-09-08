import JSZip from "jszip";
import { epubPdfBlob } from "./epubToPdf";

export type EpubPdfPart = {
  html: string;
  chapterStart: number;
  chapterEnd: number;
};
type EpubSource = {
  sourceId: string;
  scope: string;
  blob: Blob;
  name: string;
  lastModified: number;
};
type SavedPart = {
  key: string;
  sourceId: string;
  scope: string;
  htmlDigest: string;
  pdfDigest: string;
  blob: Blob;
};
const VERSION = "epub-pdf-parts-v1";
const DATABASE = "mvs-epub-pdf-checkpoints";
const pendingParts = new Map<string, Promise<Blob>>();

function checkScope(scope: string) {
  if (typeof scope !== "string" || !scope.trim())
    throw new Error("缺少当前账号的电子书保存范围，请重新登录后重试");
}
async function digest(data: BufferSource) {
  if (!globalThis.crypto?.subtle)
    throw new Error("当前浏览器无法校验电子书，请在安全连接中重试");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}
const textDigest = (text: string) => digest(new TextEncoder().encode(text));
function storageError(error?: unknown) {
  const detail =
    error instanceof Error ? error.message : String(error || "未知存储错误");
  return new Error(
    `浏览器电子书存储不可用或空间不足，未保存的分片不会标记完成。请检查浏览器存储后重试：${detail}`
  );
}
async function openDatabase(): Promise<IDBDatabase> {
  try {
    if (!globalThis.indexedDB) throw new Error("此浏览器未提供 IndexedDB");
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ["sources", "parts", "meta"])
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        rejected = true;
        reject(
          new Error("电子书存储正在被其他页面占用，请关闭该书的旧页面后重试")
        );
      };
      request.onsuccess = () => {
        if (rejected) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  } catch (error) {
    throw storageError(error);
  }
}
const requested = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<T>
) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(stores, mode);
    const completed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("本地保存事务已中止"));
      tx.onerror = () => reject(tx.error || new Error("本地保存事务失败"));
    });
    // 同时观察请求与事务，避免请求成功后事务回滚却被误报为已保存。
    const [result] = await Promise.all([
      action(tx).catch(error => {
        try {
          tx.abort();
        } catch {}
        throw error;
      }),
      completed,
    ]);
    return result;
  } catch (error) {
    throw storageError(error);
  } finally {
    db.close();
  }
}
const sourceKey = (scope: string, sourceId: string) =>
  JSON.stringify([scope, sourceId]);
const latestKey = (scope: string) => JSON.stringify([scope, "latest"]);
async function readSource(scope: string, sourceId: string) {
  checkScope(scope);
  const value = await transaction(["sources"], "readonly", tx =>
    requested<EpubSource | undefined>(
      tx.objectStore("sources").get(sourceKey(scope, sourceId))
    )
  );
  if (
    !value ||
    value.scope !== scope ||
    value.sourceId !== sourceId ||
    !(value.blob instanceof Blob) ||
    !value.name
  )
    throw new Error(
      "找不到当前账号已保存的原电子书，请重新导入；不会复用其他来源分片"
    );
  return value;
}

/** 原文件与当前来源指针同一事务提交；旧来源不删除、同一来源不覆盖。 */
export async function saveEpubSource(
  file: File,
  scope: string
): Promise<string> {
  checkScope(scope);
  if (!(file instanceof Blob) || !file.size || !file.name)
    throw new Error("请选择非空 EPUB 原文件");
  const fileDigest = await digest(await file.arrayBuffer());
  const sourceId = `epub-source-v1-${await textDigest(JSON.stringify([VERSION, scope, fileDigest]))}`;
  await transaction(["sources", "meta"], "readwrite", async tx => {
    const sources = tx.objectStore("sources");
    const key = sourceKey(scope, sourceId);
    const existing = await requested<EpubSource | undefined>(sources.get(key));
    if (!existing)
      await requested(
        sources.add(
          {
            sourceId,
            scope,
            blob: file,
            name: file.name,
            lastModified: file.lastModified,
          } satisfies EpubSource,
          key
        )
      );
    await requested(
      tx
        .objectStore("meta")
        .put(
          { sourceId, scope, name: file.name, lastModified: file.lastModified },
          latestKey(scope)
        )
    );
  });
  return sourceId;
}

export async function loadEpubSource(
  scope: string
): Promise<{ sourceId: string; file: File } | null> {
  checkScope(scope);
  const latest = await transaction(["meta"], "readonly", tx =>
    requested<
      | {
          sourceId: string;
          scope: string;
          name?: string;
          lastModified?: number;
        }
      | undefined
    >(tx.objectStore("meta").get(latestKey(scope)))
  );
  if (!latest) return null;
  if (latest.scope !== scope || typeof latest.sourceId !== "string")
    throw new Error("电子书来源指针无法核对，请重新导入");
  const source = await readSource(scope, latest.sourceId);
  return {
    sourceId: source.sourceId,
    file: new File([source.blob], latest.name || source.name, {
      type: source.blob.type || "application/epub+zip",
      lastModified: latest.lastModified ?? source.lastModified,
    }),
  };
}

function checkParts(parts: EpubPdfPart[]) {
  if (!Array.isArray(parts) || !parts.length)
    throw new Error("电子书没有可转换的章节分片");
  for (const part of parts)
    if (
      !part ||
      typeof part.html !== "string" ||
      !part.html.trim() ||
      !Number.isInteger(part.chapterStart) ||
      part.chapterStart < 1 ||
      !Number.isInteger(part.chapterEnd) ||
      part.chapterEnd < part.chapterStart
    )
      throw new Error("电子书分片正文或章节编号不完整，未开始转换");
}
async function convertedPart(
  scope: string,
  sourceId: string,
  part: EpubPdfPart,
  renderPart: (html: string) => Promise<string>
): Promise<Blob> {
  const htmlDigest = await textDigest(part.html);
  const key = JSON.stringify([VERSION, scope, sourceId, htmlDigest]);
  const existingWork = pendingParts.get(key);
  if (existingWork) return existingWork;
  const run = async () => {
    const cached = await transaction(["parts"], "readonly", tx =>
      requested<SavedPart | undefined>(tx.objectStore("parts").get(key))
    );
    if (cached) {
      if (
        cached.scope !== scope ||
        cached.sourceId !== sourceId ||
        cached.htmlDigest !== htmlDigest ||
        !(cached.blob instanceof Blob) ||
        cached.blob.size < 20 ||
        !(await cached.blob.slice(0, 5).text()).startsWith("%PDF-") ||
        (await digest(await cached.blob.arrayBuffer())) !== cached.pdfDigest
      )
        throw new Error(
          "已保存的 PDF 分片校验失败，原记录已保留；请核对后重试"
        );
      return cached.blob;
    }
    const blob = epubPdfBlob(await renderPart(part.html));
    const pdfDigest = await digest(await blob.arrayBuffer());
    await transaction(["parts"], "readwrite", async tx => {
      // 并发页面使用同一缓存身份时只保留先成功落盘的结果，不覆盖完成片。
      const store = tx.objectStore("parts");
      if (!(await requested(store.get(key))))
        await requested(
          store.add(
            {
              key,
              scope,
              sourceId,
              htmlDigest,
              pdfDigest,
              blob,
            } satisfies SavedPart,
            key
          )
        );
    });
    return blob;
  };
  const promise = (async () => {
    if (globalThis.navigator?.locks) return navigator.locks.request(key, run);
    return run();
  })();
  pendingParts.set(key, promise);
  try {
    return await promise;
  } finally {
    if (pendingParts.get(key) === promise) pendingParts.delete(key);
  }
}

/** 完成片逐个落盘；失败后再次调用只转换缺失片，多片交付真实 PDF ZIP。 */
export async function convertEpubPdfParts(input: {
  sourceId: string;
  scope: string;
  title: string;
  parts: EpubPdfPart[];
  renderPart: (html: string) => Promise<string>;
  onProgress?: (progress: {
    done: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<{ blob: Blob; name: string; partCount: number }> {
  const { sourceId, scope, renderPart, onProgress } = input;
  checkScope(scope);
  checkParts(input.parts);
  const parts = input.parts.map(part => ({ ...part }));
  const safeTitle =
    String(input.title || "电子书")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .trim() || "电子书";
  await readSource(scope, sourceId);
  const zip = parts.length > 1 ? new JSZip() : null;
  let single: Blob | undefined;
  await onProgress?.({ done: 0, total: parts.length });
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const blob = await convertedPart(scope, sourceId, part, renderPart);
    if (zip)
      zip.file(
        `${String(index + 1).padStart(Math.max(4, String(parts.length).length), "0")}-第${part.chapterStart}至${part.chapterEnd}章.pdf`,
        blob
      );
    else single = blob;
    await onProgress?.({ done: index + 1, total: parts.length });
  }
  return {
    blob: zip
      ? await zip.generateAsync({
          type: "blob",
          compression: "STORE",
          mimeType: "application/zip",
        })
      : single!,
    name: zip ? `${safeTitle}-分片PDF.zip` : `${safeTitle}.pdf`,
    partCount: parts.length,
  };
}
