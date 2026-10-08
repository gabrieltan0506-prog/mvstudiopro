import { currentManhuaProjectScope } from "@shared/manhuaProjectScope";
import { voiceStoryboardResultState, type VoiceStoryboardCandidate } from "./creativeVoiceStoryboard";

const DATABASE = "mv-manhua-storyboard-candidates-v1";
const STORE = "candidates";
const PREFIX = "mvs:voice-storyboard:v1:";
type LegacyStorage = Pick<Storage, "getItem">;
type SavedRow = { raw: string | null; legacyRaw: string | null };

function identity(key: string, candidateScope?: string) {
  const scope = candidateScope || key.slice(PREFIX.length);
  const owner = scope.split(":")[0];
  const project = currentManhuaProjectScope();
  if (!(key === PREFIX + scope || candidateScope && key.startsWith(`${PREFIX}${scope}:history:`)) || !/^[1-9]\d*$/.test(owner) || scope.length <= owner.length + 1 ||
    project && (project.ownerId !== owner || scope !== `${owner}:${project.projectId}`))
    throw new Error("分镜候选账户或作品归属无效，原记录保留。");
  return { scope, namespace: project ? `project:${owner}:${project.projectId}:` : `legacy:${owner}:` };
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("分镜候选存储无法打开，未提交或采用。"));
    request.onblocked = () => reject(new Error("另一页面正在更新分镜存储，请保留草稿后重试。"));
  });
}

function originalRaw(storage: LegacyStorage, key: string, row?: SavedRow): string | null {
  const legacy = storage.getItem(key);
  // 新旧页面并存时，旧页面新写的未知请求不能被新存储的空记录遮住。
  if (row && row.legacyRaw !== legacy) throw new Error("旧页面已改变分镜请求，原记录保留，请先核对。" );
  return row ? row.raw : legacy;
}

function checkedCandidate(raw: string, scope: string): VoiceStoryboardCandidate {
  const value = JSON.parse(raw) as VoiceStoryboardCandidate;
  if (value?.scope !== scope || !value.id || !Number.isInteger(value.episode) || value.episode < 1 ||
    !["pending", "ready", "failed"].includes(value.status)) throw new Error("分镜候选记录不完整或归属不符，原记录保留。" );
  return value;
}

/** 完整快照保存在事务存储；旧 localStorage 记录只读保留，不迁移删除。 */
export async function readVoiceStoryboardRaw(storage: LegacyStorage, key: string): Promise<string | null> {
  const before = identity(key);
  const db = await openDatabase();
  try {
    if (identity(key).namespace !== before.namespace) throw new Error("读取分镜期间作品已切换，未读取旧作品候选。");
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(before.namespace + key);
      let raw: string | null = null, failure: unknown;
      request.onsuccess = () => {
        try { raw = originalRaw(storage, key, request.result); if (raw) checkedCandidate(raw, before.scope); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => {
        try {
          if (identity(key).namespace !== before.namespace) throw new Error("读取分镜期间作品已切换，未读取旧作品候选。");
          resolve(raw);
        } catch (error) { reject(error); }
      };
      tx.onabort = () => reject(failure || tx.error || new Error("分镜候选读取失败，不能视为没有原请求。"));
    });
  } finally { db.close(); }
}

export async function saveVoiceStoryboardDurable(storage: LegacyStorage, key: string, candidate: VoiceStoryboardCandidate,
  options: { expectedRaw?: string | null } = {}): Promise<void> {
  const before = identity(key, candidate.scope), json = JSON.stringify(candidate);
  checkedCandidate(json, before.scope);
  const db = await openDatabase();
  try {
    if (identity(key, candidate.scope).namespace !== before.namespace) throw new Error("保存分镜期间作品已切换，原记录保留。");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), storageKey = before.namespace + key;
      const request = store.get(storageKey);
      let verified = false, failure: unknown;
      request.onsuccess = () => {
        try {
          const raw = originalRaw(storage, key, request.result);
          if (Object.prototype.hasOwnProperty.call(options, "expectedRaw") && raw !== options.expectedRaw)
            throw new Error("另一窗口已保存分镜请求，未覆盖原请求。");
          const historical = key !== PREFIX + candidate.scope;
          if (raw && (historical ? raw !== json : checkedCandidate(raw, before.scope).id !== candidate.id))
            throw new Error("分镜请求或历史版本已变化，未覆盖原记录。");
          if (raw && !historical) {
            const previous = checkedCandidate(raw, before.scope);
            if (previous.text?.trim() && previous.text !== candidate.text ||
              previous.status === "ready" && candidate.status !== "ready" && !Object.prototype.hasOwnProperty.call(options, "expectedRaw"))
              throw new Error("原完整分镜已返回，未用较早状态覆盖原结果。");
          }
          const legacyRaw = storage.getItem(key);
          store.put({ raw: json, legacyRaw } satisfies SavedRow, storageKey);
          const check = store.get(storageKey);
          check.onsuccess = () => {
            try {
              verified = check.result?.raw === json && storage.getItem(key) === legacyRaw && identity(key, candidate.scope).namespace === before.namespace;
              if (!verified) throw new Error("分镜候选未完整保存或作品已切换，原稿未修改。");
            } catch (error) { failure = error; tx.abort(); }
          };
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => verified ? resolve() : reject(new Error("分镜候选未完整保存，原稿未修改。"));
      tx.onabort = () => reject(failure || tx.error || new Error("分镜候选保存失败，原稿未修改。"));
    });
  } finally { db.close(); }
}

/** 原请求与完整历史同一事务归档；保留旧存储，以空标记解除已知终态。 */
export async function archiveVoiceStoryboardDurable(storage: LegacyStorage, key: string, candidate: VoiceStoryboardCandidate): Promise<void> {
  const before = identity(key, candidate.scope), json = JSON.stringify(candidate);
  checkedCandidate(json, before.scope);
  if (voiceStoryboardResultState(candidate) === "unknown") throw new Error("原请求结果未知，不能归档后重复提交。");
  const db = await openDatabase();
  try {
    if (key !== PREFIX + candidate.scope || identity(key, candidate.scope).namespace !== before.namespace) throw new Error("归档期间作品已切换或请求归属无效，原请求保留。");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), storageKey = before.namespace + key;
      const request = store.get(storageKey);
      let failure: unknown, verified = false;
      request.onsuccess = () => {
        try {
          if (originalRaw(storage, key, request.result) !== json) throw new Error("原请求已变化，未归档或解除。");
          const legacyRaw = storage.getItem(key);
          const historyKey = `${storageKey}:history:${candidate.id}:archived:${crypto.randomUUID()}`;
          store.add({ raw: json, legacyRaw: null } satisfies SavedRow, historyKey);
          store.put({ raw: null, legacyRaw } satisfies SavedRow, storageKey);
          const check = store.get(historyKey);
          check.onsuccess = () => {
            try {
              verified = check.result?.raw === json && storage.getItem(key) === legacyRaw && identity(key, candidate.scope).namespace === before.namespace;
              if (!verified) throw new Error("归档未完整保存，原请求保留。");
            } catch (error) { failure = error; tx.abort(); }
          };
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => verified ? resolve() : reject(new Error("归档未完整保存，原请求保留。"));
      tx.onabort = () => reject(failure || tx.error || new Error("归档保存失败，原请求保留。"));
    });
  } finally { db.close(); }
}
