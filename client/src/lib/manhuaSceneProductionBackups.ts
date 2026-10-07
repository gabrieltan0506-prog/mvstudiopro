import { currentManhuaProjectScope } from "../../../shared/manhuaProjectScope";
import { listAdvisorBackups, type AdvisorBackupEntry } from "./manhuaAdvisorBackups";

const DATABASE = "mv-manhua-scene-production-backups-v1";
const STORE = "backups";
function namespace(userId: string) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("备份账户无效。");
  const scope = currentManhuaProjectScope();
  if (scope && scope.ownerId !== userId) throw new Error("备份作品不属于当前账户。");
  return scope ? `project:${scope.ownerId}:${scope.projectId}:` : `legacy:${userId}:`;
}
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("场景制作备份无法打开，未提交生成。"));
    request.onblocked = () => reject(new Error("另一页面正在更新备份，请保留方案后稍后再试。"));
  });
}
/** Full snapshots live outside the small localStorage quota. Never delete legacy records. */
export async function saveSceneProductionBackup(userId: string, key: string, json: string): Promise<void> {
  if (!/^[1-9]\d*$/.test(userId) || !key.startsWith(`manhua-advisor-rewrite-backup:${userId}:`))
    throw new Error("场景制作备份归属无效，未提交生成。");
  const storageKey = namespace(userId) + key;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
      // Add is deliberately immutable: collisions cannot overwrite old evidence.
      store.add(json, storageKey);
      const check = store.get(storageKey);
      let verified = false;
      check.onsuccess = () => { verified = check.result === json; if (!verified) tx.abort(); };
      tx.oncomplete = () => verified ? resolve() : reject(new Error("场景制作备份未完整保存，未提交生成。"));
      tx.onabort = () => reject(tx.error || new Error("场景制作备份保存失败，未提交生成。"));
    });
  } finally { db.close(); }
}
export async function listSceneProductionBackups(scope: Parameters<typeof listAdvisorBackups>[1]): Promise<AdvisorBackupEntry[]> {
  const storageNamespace = namespace(scope.userId);
  const db = await openDatabase();
  try {
    const rows = await new Promise<Array<{key: string; json: string}>>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"), store = tx.objectStore(STORE);
      const prefix = `${storageNamespace}manhua-advisor-rewrite-backup:${scope.userId}:`;
      const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      const rows: Array<{key: string; json: string}> = [];
      request.onsuccess = () => { const cursor = request.result; if (cursor) { rows.push({key: String(cursor.key).slice(storageNamespace.length),json: String(cursor.value)}); cursor.continue(); } };
      tx.oncomplete = () => resolve(rows);
      tx.onabort = () => reject(tx.error || new Error("场景备份暂无法读取。"));
    });
    const result = listAdvisorBackups({length: rows.length, key: i => rows[i]?.key ?? null, getItem: key => rows.find(row => row.key === key)?.json ?? null}, scope);
    return result.entries.map(entry => ({...entry, downloadOnly: true}));
  } finally { db.close(); }
}
