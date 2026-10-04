import {
  readNovelWorkspace,
  novelWorkspaceKey,
  type NovelWorkspace,
} from "./novelWorkspace";

/** Large drafts and receipt history use IndexedDB; legacy localStorage remains untouched. */
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mv-novel-workspaces", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read(key: string): Promise<string | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readonly");
      const request = tx.objectStore("drafts").get(key);
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function saveNovelWorkspaceDb(
  userId: string,
  previous: string | null,
  value: NovelWorkspace,
  archiveKey?: string
) {
  const db = await database();
  const key = novelWorkspaceKey(userId),
    raw = JSON.stringify(value);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"),
        store = tx.objectStore("drafts");
      let conflict = false;
      const request = store.get(key);
      request.onsuccess = () => {
        if ((request.result ?? null) !== previous) {
          conflict = true;
          tx.abort();
          return;
        }
        if (archiveKey && previous)
          store.put(previous, `${key}:archive:${archiveKey}`);
        store.put(raw, key);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          conflict
            ? new Error("另一页面已更新，请下载当前备份再刷新。")
            : tx.error || new Error("本机保存失败")
        );
    });
    return raw;
  } finally {
    db.close();
  }
}
export async function readNovelWorkspaceDb(userId: string) {
  let raw = await read(novelWorkspaceKey(userId));
  if (raw === null) {
    const legacy = readNovelWorkspace(localStorage, userId);
    if (legacy.raw !== null) {
      // Two tabs migrating the same draft converge; a different winner is read normally.
      try {
        raw = await saveNovelWorkspaceDb(userId, null, legacy.value);
      } catch {
        raw = await read(novelWorkspaceKey(userId));
        if (raw === null) throw new Error("草稿迁移失败，原稿保留");
      }
    }
  }
  return readNovelWorkspace({ getItem: () => raw }, userId);
}
