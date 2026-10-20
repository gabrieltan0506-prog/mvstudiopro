import {
  readNovelWorkspace,
  novelWorkspaceKey,
  type NovelWorkspace,
} from "./novelWorkspace";

const projectIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function novelProjectKey(userId: string, projectId: string) {
  if (!projectIdPattern.test(projectId)) throw new Error("小说作品地址无效");
  return `${novelWorkspaceKey(userId)}:project:${projectId}`;
}
export function novelProjectHref(userId: string, projectId: string) {
  novelProjectKey(userId, projectId);
  return `/novel-adaptation?project=${encodeURIComponent(projectId)}&owner=${encodeURIComponent(userId)}`;
}

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
  archiveKey?: string,
  projectId?: string
) {
  if (projectId && (value.projectId || value.roundId) !== projectId)
    throw new Error("作品身份不一致，未覆盖当前小说");
  const db = await database();
  const key = projectId
      ? novelProjectKey(userId, projectId)
      : novelWorkspaceKey(userId),
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
        if (projectId) store.put(new Date().toISOString(), `${key}:updatedAt`);
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
export async function readNovelWorkspaceDb(userId: string, projectId?: string) {
  let raw = await read(
    projectId ? novelProjectKey(userId, projectId) : novelWorkspaceKey(userId)
  );
  if (projectId) {
    if (raw === null)
      throw new Error("本机没有这部小说，请从我的小说打开云端保存的版本。");
    const loaded = readNovelWorkspace({ getItem: () => raw }, userId);
    if ((loaded.value.projectId || loaded.value.roundId) !== projectId)
      throw new Error("小说作品身份不一致，原稿保留");
    return loaded;
  }
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

export type NovelProjectSummary = {
  projectId: string;
  title: string;
  mode: NovelWorkspace["mode"];
  season: number;
  chapterCount: number;
  updatedAt: string;
  pending: boolean;
};

/** 旧活动稿与封存稿只补入缺失作品；不删除旧键，也不覆盖已编辑的新作品。 */
export async function listNovelProjectsDb(userId: string) {
  const base = novelWorkspaceKey(userId);
  const db = await database();
  try {
    return await new Promise<{
      projects: NovelProjectSummary[];
      unreadable: number;
    }>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"),
        store = tx.objectStore("drafts");
      const keys = store.getAllKeys(),
        values = store.getAll();
      let projects: NovelProjectSummary[] = [],
        unreadable = 0;
      let failure: unknown;
      values.onsuccess = () => {
        try {
          const rows = new Map(
            keys.result.map((key, i) => [
              String(key),
              values.result[i] as string,
            ])
          );
          const legacy = localStorage.getItem(base);
          if (!rows.has(base) && legacy) rows.set(base, legacy);
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(`${base}:archive:`) && !rows.has(key))
              rows.set(key, localStorage.getItem(key)!);
          }
          const old = Array.from(rows)
            .filter(
              ([key]) => key === base || key.startsWith(`${base}:archive:`)
            )
            .sort(([a], [b]) =>
              a === base ? -1 : b === base ? 1 : b.localeCompare(a)
            );
          for (const [, raw] of old) {
            try {
              const value = readNovelWorkspace(
                { getItem: () => raw },
                userId
              ).value;
              const id = value.projectId || value.roundId;
              const key = novelProjectKey(userId, id);
              if (!rows.has(key)) {
                const migrated = JSON.stringify({ ...value, projectId: id });
                rows.set(key, migrated);
                store.put(migrated, key);
              }
            } catch {
              unreadable++;
            }
          }
          for (const [key, raw] of Array.from(rows)) {
            if (!key.startsWith(`${base}:project:`)) continue;
            const id = key.slice(`${base}:project:`.length);
            if (!projectIdPattern.test(id)) continue;
            try {
              const value = readNovelWorkspace(
                { getItem: () => raw },
                userId
              ).value;
              if ((value.projectId || value.roundId) !== id)
                throw new Error("作品身份不一致");
              projects.push({
                projectId: id,
                title: value.topic || "未命名小说",
                mode: value.mode,
                season: value.season || 1,
                chapterCount: value.chapters.filter(c => c.trim()).length,
                updatedAt: rows.get(`${key}:updatedAt`) || "",
                pending: Boolean(value.pending),
              });
            } catch {
              unreadable++;
            }
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () =>
        resolve({
          projects: projects.sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          ),
          unreadable,
        });
      tx.onabort = () =>
        reject(failure || tx.error || new Error("作品列表读取失败"));
    });
  } finally {
    db.close();
  }
}
