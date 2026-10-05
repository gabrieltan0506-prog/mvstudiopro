type RefreshStorage = Pick<Storage, "getItem" | "setItem">;
export type ManhuaStoryAssetRefreshRunRecord = {
  version: 1;
  operationId: string;
  scopeKey: string;
  sourceFingerprint: string;
  status: "started" | "settings_received" | "images_running" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
  settingsText?: string;
  imageTasks: Array<{ blockId: string; jobId: string; receivedAt: string }>;
  result?: { planned: number; completed: number };
  error?: string;
};

/** 存储不可写时仍把已取得的原文和任务号交给宿主保全，不能靠重付费找回。 */
export class ManhuaStoryAssetRefreshRunError extends Error {
  constructor(message: string, public readonly record: ManhuaStoryAssetRefreshRunRecord | null) {
    super(message);
    this.name = "ManhuaStoryAssetRefreshRunError";
  }
}

export type ManhuaStoryAssetRefreshRunInput = {
  storage: RefreshStorage;
  key: string;
  operationId: string;
  scopeKey: string;
  sourceFingerprint: string;
  /** 宿主核对当前账号/作品与已接受剧情；写三表不应改变这一剧情指纹。 */
  isCurrent: () => boolean;
  generateSettings: (input: { operationId: string }) => Promise<string>;
  /** 使用原解析、写表和资产生图入口；每次写回/提交前调用assertCurrent。 */
  applySettingsAndGenerateImages: (text: string, controls: {
    assertCurrent: () => void;
    onImageTaskCreated: (blockId: string, jobId: string) => void;
  }) => Promise<{ planned: number; completed: number }>;
};

const statuses = new Set(["started", "settings_received", "images_running", "done", "failed"]);
function readRecord(raw: string): ManhuaStoryAssetRefreshRunRecord {
  const record = JSON.parse(raw) as ManhuaStoryAssetRefreshRunRecord;
  if (!record || typeof record !== "object" || record.version !== 1 ||
    ![record.operationId, record.scopeKey, record.sourceFingerprint].every(value => typeof value === "string" && value.trim()) || !statuses.has(record.status) ||
    !Array.isArray(record.imageTasks) || record.imageTasks.some(task => !task || typeof task.blockId !== "string" || !task.blockId || typeof task.jobId !== "string" || !task.jobId) ||
    typeof record.createdAt !== "string" || typeof record.updatedAt !== "string" ||
    (record.settingsText !== undefined && typeof record.settingsText !== "string"))
    throw new Error("原资产更新记录不可读取，请保留记录并核对原任务，未重新提交。");
  return record;
}

/** 仅供页面恢复展示与只读任务查询；读取本身绝不触发模型或生图。 */
export function readManhuaStoryAssetRefreshRun(storage: Pick<Storage, "getItem">, key: string): ManhuaStoryAssetRefreshRunRecord | null {
  const raw = storage.getItem(key);
  return raw ? readRecord(raw) : null;
}

const activeKeys = new Set<string>();

/** 一次确认只执行一次；失败/未知回执均保留，调用此函数不会隐式重试。 */
export async function runManhuaStoryAssetRefresh(input: ManhuaStoryAssetRefreshRunInput): Promise<ManhuaStoryAssetRefreshRunRecord> {
  if (![input.key, input.operationId, input.scopeKey, input.sourceFingerprint].every(value => typeof value === "string" && value.trim()))
    throw new ManhuaStoryAssetRefreshRunError("资产更新缺少作品、剧情或操作身份，未提交。", null);
  const lockKey = `manhua-story-asset-refresh:${input.scopeKey}:${input.key}`;
  if (activeKeys.has(lockKey)) throw new ManhuaStoryAssetRefreshRunError("本次资产更新正在执行，请查询原任务，未重复提交。", null);
  activeKeys.add(lockKey);
  try {
    // 正式页面用浏览器排他锁防止同作品两个标签同时越过本机记录检查。
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(lockKey, { ifAvailable: true }, async lock => {
        if (!lock) throw new ManhuaStoryAssetRefreshRunError("另一标签正在更新本作品资产，未重复提交。", null);
        return executeRefresh(input);
      });
    }
    if (typeof window !== "undefined") throw new ManhuaStoryAssetRefreshRunError("当前浏览器无法锁定资产更新，请先恢复安全的工作流环境，未提交。", null);
    return await executeRefresh(input);
  } finally { activeKeys.delete(lockKey); }
}

async function executeRefresh(input: ManhuaStoryAssetRefreshRunInput): Promise<ManhuaStoryAssetRefreshRunRecord> {
  let record: ManhuaStoryAssetRefreshRunRecord | null = null;
  let lastSaved: string | null = null;
  let receiptError: Error | null = null;
  const owns = (value: ManhuaStoryAssetRefreshRunRecord) => value.operationId === input.operationId && value.scopeKey === input.scopeKey && value.sourceFingerprint === input.sourceFingerprint;
  const assertCurrent = () => {
    if (receiptError) throw receiptError;
    if (!input.isCurrent()) throw new Error("作品或已接受剧情已变化，原回执保留，未写入当前作品。");
    if (input.storage.getItem(input.key) !== lastSaved) throw new Error("资产更新记录已被其他操作改变，请核对原任务，未继续提交。");
  };
  const save = (next: ManhuaStoryAssetRefreshRunRecord) => {
    record = next;
    if (input.storage.getItem(input.key) !== lastSaved) throw new Error("资产更新记录已变化，未覆盖其他操作。");
    const json = JSON.stringify(next);
    input.storage.setItem(input.key, json);
    if (input.storage.getItem(input.key) !== json) throw new Error("资产更新回执未完整保存，请保留当前页面核对原任务。");
    lastSaved = json;
  };
  try {
    lastSaved = input.storage.getItem(input.key);
    if (lastSaved) {
      const previous = readRecord(lastSaved);
      if (previous.scopeKey !== input.scopeKey) throw new ManhuaStoryAssetRefreshRunError("记录属于其他作品，未覆盖或提交。", previous);
      if (previous.status !== "done") throw new ManhuaStoryAssetRefreshRunError("原资产更新尚未确认完成，请查询原任务，未重复提交。", previous);
      if (previous.sourceFingerprint === input.sourceFingerprint) { assertCurrent(); return previous; }
      if (previous.operationId === input.operationId) throw new ManhuaStoryAssetRefreshRunError("同一操作编号对应的剧情已改变，未重新提交。", previous);
      const historyKey = `${input.key}:history:${encodeURIComponent(previous.operationId)}`;
      const history = input.storage.getItem(historyKey);
      if (history && history !== lastSaved) throw new Error("原资产更新历史已存在不同内容，未覆盖或提交。");
      input.storage.setItem(historyKey, lastSaved);
      if (input.storage.getItem(historyKey) !== lastSaved) throw new Error("原资产更新回执未能归档，未提交新的任务。");
    }
    assertCurrent();
    const now = new Date().toISOString();
    save({ version: 1, operationId: input.operationId, scopeKey: input.scopeKey, sourceFingerprint: input.sourceFingerprint,
      status: "started", createdAt: now, updatedAt: now, imageTasks: [] });
    assertCurrent();
    const settingsText = await input.generateSettings({ operationId: input.operationId });
    // 无论稍后校验/解析是否成功，先保全已付费取得的完整模型原文。
    save({ ...record!, status: "settings_received", settingsText, updatedAt: new Date().toISOString() });
    if (typeof settingsText !== "string" || !settingsText.trim()) throw new Error("资产模型没有返回可用设定，原稿和旧图片保留。");
    assertCurrent();
    save({ ...record!, status: "images_running", updatedAt: new Date().toISOString() });
    const result = await input.applySettingsAndGenerateImages(settingsText, {
      assertCurrent,
      onImageTaskCreated: (blockId, jobId) => {
        try {
          if (!blockId?.trim() || !jobId?.trim()) throw new Error("资产图片提交缺少真实任务编号，停止后续提交。");
          const existing = record!.imageTasks.find(task => task.jobId === jobId);
          if (existing && existing.blockId !== blockId) throw new Error("同一图片任务对应不同资产，停止后续提交。");
          if (!existing) save({ ...record!, imageTasks: [...record!.imageTasks, { blockId, jobId, receivedAt: new Date().toISOString() }], updatedAt: new Date().toISOString() });
          // scope变化也先保存原任务回执，随后阻止原宿主继续写入新作品。
          assertCurrent();
        } catch (cause) {
          receiptError = cause instanceof Error ? cause : new Error("图片任务回执未能保存，停止后续提交。");
          throw receiptError;
        }
      },
    });
    if (receiptError) throw receiptError;
    assertCurrent();
    if (!result || !Number.isSafeInteger(result.planned) || !Number.isSafeInteger(result.completed) || result.planned < 0 || result.completed < 0 || result.completed > result.planned)
      throw new Error("原资产流程没有返回完整结果回执，原任务保留，不自动重试。");
    save({ ...record!, result, updatedAt: new Date().toISOString() });
    if (result.completed !== result.planned || (result.planned > 0 && !record!.imageTasks.length))
      throw new Error("资产图片尚未全部取得成功回执，请查询原任务；旧图片保留，不自动重试。");
    save({ ...record!, status: "done", updatedAt: new Date().toISOString() });
    return record!;
  } catch (cause) {
    if (cause instanceof ManhuaStoryAssetRefreshRunError) throw cause;
    const message = cause instanceof Error ? cause.message : "资产更新失败，原文及任务回执保留，不自动重试。";
    const activeRecord = record as ManhuaStoryAssetRefreshRunRecord | null;
    if (activeRecord) {
      const failed: ManhuaStoryAssetRefreshRunRecord = { ...activeRecord, status: "failed", error: message, updatedAt: new Date().toISOString() };
      record = failed;
      try {
        const current = input.storage.getItem(input.key);
        if (current && owns(readRecord(current))) {
          lastSaved = current;
          save(failed);
        }
      } catch { /* 完整record随错误交回宿主，不能为保存失败重提付费任务。 */ }
    }
    throw new ManhuaStoryAssetRefreshRunError(message, record);
  }
}
