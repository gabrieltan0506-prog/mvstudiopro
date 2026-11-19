/**
 * 图文手册导出改为「发起即返回任务标识、后台执行、前台轮询」（1111）。
 *
 * 原 exportPublication 是一条同步长请求（整册分段测量 + 渲染 + 合并，历史上单次可达数十分钟），页面刷新或网络抖动即丢结果。
 *
 * 语义：
 * - 任务键 = 账号 | 稿件 | 云稿 generation；同键重复发起复用进行中/已完成的任务（刷新后重新发起即可续看）。
 * - 同一成品目录（导出前缀，由内容摘要决定）已有进行中的导出时，新任务直接等待那一次，不重复渲染。
 * - 结算幂等沿用 exportKnowledgePublication 内既有逻辑（按稿件结算键，重复导出不重复扣费）。
 * - 查询只返回本人任务：键含账号，存放路径按账号分目录，查询时校验账号。
 *
 * 1119 持久化（E4，存于出版证据同一 GCS 桶，不新增数据库表）：
 * - 任务记录 knowledge-publications/user-<账号>/export-tasks/<任务标识>.json：发起、完成时写入。
 *   进程重启后用同一稿件版本重新发起（前台遇 missing 即重新发起），30 分钟内已成功的任务直接返回原结果，不再执行。
 * - 渲染租约 knowledge-publications/user-<账号>/export-leases/<成品目录摘要>.json：任何一次执行导出之前，
 *   必须以条件写入（ifGenerationMatch）取得租约；持有期间每分钟续一次心跳（同样条件写入，失败不算续期）。
 *   另一台机器 / 另一个请求发现租约「进行中且心跳新鲜」即等待，持有者结束后再取租约执行——此时成品清单已在，
 *   导出直接复用，不重复渲染（部分失败的也只补失败段）。
 * - 进程在执行中死掉：租约停在 running，心跳不再更新；连续 10 分钟无心跳即视为失联，下一个等待者/新发起者条件写入接管并重试，
 *   已完成分片照常复用。条件写入保证同一时刻只有一个持有者；不会永远卡住（失联上限 10 分钟），也不会两路同时渲染
 *   （唯一例外：持有者自己连续 10 分钟写不进心跳却仍在渲染——其心跳条件写入随即失败、记日志，见报告）。
 * - 未注入存储（单元测试的旧用例）时退回纯进程内语义，与 1111 版一致。
 */
import { createHash, randomUUID } from "node:crypto";
import { knowledgePublicationPublicError } from "../../shared/knowledgePublicationPublic";
import type { KnowledgePublicationExport } from "./knowledgePublicationExport";
import { knowledgeTimingLog } from "./knowledgePublicationCache";

export type KnowledgeExportTaskState =
  | { status: "running"; taskId: string; startedAt: number }
  | { status: "succeeded"; taskId: string; startedAt: number; finishedAt: number; result: KnowledgePublicationExport }
  | { status: "failed"; taskId: string; startedAt: number; finishedAt: number; error: string; retryable: boolean };

/** 带版本的 JSON 存储：read 返回内容与 generation；write 以 ifGeneration 条件写入（null = 只在不存在时创建），条件不满足返回 ok:false。 */
export type KnowledgeExportTaskStore = {
  read(name: string): Promise<{ value: any; generation: string } | null>;
  write(name: string, value: unknown, ifGeneration: string | null): Promise<{ ok: true; generation: string } | { ok: false }>;
  put(name: string, value: unknown): Promise<void>;
};

type Task = { owner: number; key: string; state: KnowledgeExportTaskState; promise: Promise<void> };
type Deps = {
  run: (owner: number, documentId: string, generation: string) => Promise<KnowledgePublicationExport>;
  /** 取导出成品目录（同目录去重）；取不到时按任务键去重即可。 */
  prefix?: (owner: number, documentId: string, generation: string) => Promise<string>;
  now?: () => number;
  /** 持久存储；缺省为纯进程内（旧语义）。 */
  store?: KnowledgeExportTaskStore;
  /** 本进程持有者标识（缺省随机）。 */
  holder?: string;
  sleep?: (ms: number) => Promise<void>;
  /** 周期执行（心跳）；返回取消函数。 */
  every?: (ms: number, fn: () => void) => () => void;
  heartbeatMs?: number;
  staleMs?: number;
  pollMs?: number;
};

const KEEP_FINISHED_MS = 30 * 60_000;
const MAX_TASKS = 200;
/** 续租间隔。 */
export const KNOWLEDGE_EXPORT_LEASE_HEARTBEAT_MS = 60_000;
/** 连续这么久无有效心跳即视为失联、可接管（与长任务失联窗口一致：10 分钟）。 */
export const KNOWLEDGE_EXPORT_LEASE_STALE_MS = 10 * 60_000;
/** 等待他人持有的租约时的查询间隔。 */
export const KNOWLEDGE_EXPORT_LEASE_POLL_MS = 5_000;

export const knowledgeExportTaskRecordName = (owner: number, taskId: string) => `knowledge-publications/user-${owner}/export-tasks/${taskId}.json`;
export const knowledgeExportLeaseName = (owner: number, renderKey: string) =>
  `knowledge-publications/user-${owner}/export-leases/${createHash("sha256").update(renderKey).digest("hex").slice(0, 32)}.json`;
type Lease = { kind: "knowledge_export_lease_v1"; renderKey: string; holder: string; status: "running" | "succeeded" | "failed"; startedAt: number; heartbeatAt: number; finishedAt?: number };
/** 完整成功 = 成功且已得到整册 PDF；只保存了 HTML、PDF 有段未完成的结果须可续做，不当成品复用。 */
const complete = (state: KnowledgeExportTaskState) => state.status === "succeeded" && !!state.result?.pdfUrl && !state.result.pdfError;
const safeLog = (error: unknown) => String((error as Error)?.message ?? error).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 300);

export function createKnowledgeExportTasks(deps: Deps) {
  const tasks = new Map<string, Task>();
  const starting = new Map<string, Promise<KnowledgeExportTaskState>>();
  const byPrefix = new Map<string, Promise<KnowledgePublicationExport>>();
  /** 本进程正持有租约并在执行的渲染键。 */
  const holding = new Set<string>();
  const now = deps.now ?? Date.now;
  const holder = deps.holder ?? randomUUID();
  const sleep = deps.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const every = deps.every ?? ((ms, fn) => { const t = setInterval(fn, ms); t.unref?.(); return () => clearInterval(t); });
  const heartbeatMs = deps.heartbeatMs ?? KNOWLEDGE_EXPORT_LEASE_HEARTBEAT_MS;
  const staleMs = deps.staleMs ?? KNOWLEDGE_EXPORT_LEASE_STALE_MS;
  const pollMs = deps.pollMs ?? KNOWLEDGE_EXPORT_LEASE_POLL_MS;
  const taskIdOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);
  const prune = () => {
    for (const [id, task] of Array.from(tasks.entries()))
      if (task.state.status !== "running" && now() - task.state.finishedAt > KEEP_FINISHED_MS) tasks.delete(id);
    while (tasks.size > MAX_TASKS) {
      const oldest = Array.from(tasks.entries()).find(([, t]) => t.state.status !== "running");
      if (!oldest) break;
      tasks.delete(oldest[0]);
    }
  };
  /** 取得渲染租约后执行一次导出；他人持有且心跳新鲜时等待，失联（staleMs 无心跳）即接管。 */
  const runWithLease = async (store: KnowledgeExportTaskStore, owner: number, renderKey: string, run: () => Promise<KnowledgePublicationExport>) => {
    const name = knowledgeExportLeaseName(owner, renderKey);
    let generation: string;
    for (;;) {
      const current = await store.read(name);
      const lease = current?.value as Lease | undefined;
      // 本进程自己留下的 running（上次释放没写进去）且本进程此刻并未在渲染这个目录：不必等失联，直接条件接管。
      const ownLeftover = lease?.holder === holder && !holding.has(renderKey);
      const busy = lease?.status === "running" && !ownLeftover && now() - Number(lease.heartbeatAt || 0) < staleMs;
      if (busy) { await sleep(pollMs); continue; }
      if (lease?.status === "running") console.warn(`[knowledgeExport] lease stale, taking over holder=${String(lease.holder).slice(0, 8)} silentMs=${now() - Number(lease.heartbeatAt || 0)}`);
      const startedAt = now();
      const claimed = await store.write(name, { kind: "knowledge_export_lease_v1", renderKey, holder, status: "running", startedAt, heartbeatAt: startedAt } satisfies Lease, current ? current.generation : null);
      if (claimed.ok) { generation = claimed.generation; break; }
      // 条件写入失败 = 别人刚取得或刚更新：重读再判断。
    }
    holding.add(renderKey);
    let lost = false, beating = false;
    const startedAt = now();
    // 条件写入 412 时先重读：上一次写入可能已生效而应答丢失（超时/断线），此时租约仍是本进程的、只是 generation 已前进。
    // 本进程渲染期间同一渲染键不会被本进程再次取得（holding），所以 holder 仍是自己即是本次的租约：采用新 generation 重写一次。
    const writeOwn = async (lease: Lease) => {
      const r = await store.write(name, lease, generation);
      if (r.ok) return r;
      const current = await store.read(name);
      if ((current?.value as Lease | undefined)?.holder !== holder) return r;
      return store.write(name, lease, current!.generation);
    };
    const stop = every(heartbeatMs, () => {
      if (lost || beating) return;
      beating = true;
      void writeOwn({ kind: "knowledge_export_lease_v1", renderKey, holder, status: "running", startedAt, heartbeatAt: now() })
        .then(r => { if (r.ok) generation = r.generation; else { lost = true; console.warn("[knowledgeExport] lease lost to another holder; this render continues but will not release the lease"); } },
          e => console.warn(`[knowledgeExport] lease heartbeat not written (not counted as renewal) reason=${safeLog(e)}`))
        .finally(() => { beating = false; });
    });
    let outcome: "succeeded" | "failed" = "failed";
    try {
      const result = await run();
      outcome = "succeeded";
      return result;
    } finally {
      stop();
      holding.delete(renderKey);
      // 等在途心跳落定，再以最新 generation 释放；释放失败只记日志——租约随后在 staleMs 内失联、可被接管。
      while (beating) await sleep(10);
      if (!lost) {
        await writeOwn({ kind: "knowledge_export_lease_v1", renderKey, holder, status: outcome, startedAt, heartbeatAt: now(), finishedAt: now() })
          .then(r => { if (!r.ok) console.warn("[knowledgeExport] lease release skipped: taken over"); }, e => console.warn(`[knowledgeExport] lease release failed reason=${safeLog(e)}`));
      }
    }
  };
  const execute = async (owner: number, documentId: string, generation: string) => {
    let prefix: string | undefined;
    try { prefix = deps.prefix ? await deps.prefix(owner, documentId, generation) : undefined; } catch { prefix = undefined; }
    const renderKey = prefix ? `${owner}|${prefix}` : `${owner}|${documentId}|${generation}`;
    const prefixKey = prefix ? `${owner}|${prefix}` : undefined;
    const existing = prefixKey ? byPrefix.get(prefixKey) : undefined;
    if (existing) return existing;
    const promise = deps.store ? runWithLease(deps.store, owner, renderKey, () => deps.run(owner, documentId, generation)) : deps.run(owner, documentId, generation);
    if (prefixKey) {
      byPrefix.set(prefixKey, promise);
      void promise.finally(() => { if (byPrefix.get(prefixKey) === promise) byPrefix.delete(prefixKey); }).catch(() => undefined);
    }
    return promise;
  };
  const persist = (owner: number, documentId: string, generation: string, state: KnowledgeExportTaskState) =>
    deps.store?.put(knowledgeExportTaskRecordName(owner, state.taskId), { kind: "knowledge_export_task_v1", owner, documentId, generation, state })
      .catch(e => console.warn(`[knowledgeExport] task record not written reason=${safeLog(e)}`));
  const launch = (owner: number, documentId: string, generation: string, key: string, taskId: string): KnowledgeExportTaskState => {
    const startedAt = now();
    const task: Task = { owner, key, state: { status: "running", taskId, startedAt }, promise: Promise.resolve() };
    // 任务记录写入与执行并行；记录写失败只记日志（状态仍在内存，重启后用户重新发起）。所有分支都已捕获，不产生未处理拒绝。
    const record = persist(owner, documentId, generation, task.state);
    task.promise = execute(owner, documentId, generation).then(result => {
      task.state = { status: "succeeded", taskId, startedAt, finishedAt: now(), result };
      knowledgeTimingLog("knowledgeExport.task", startedAt, { ok: true, pages: result.totalPages });
    }, error => {
      const safe = knowledgePublicationPublicError(error);
      console.warn(`[knowledgeExport] task failed reason=${safeLog(error)}`);
      task.state = { status: "failed", taskId, startedAt, finishedAt: now(), error: safe.message, retryable: safe.retryable };
      knowledgeTimingLog("knowledgeExport.task", startedAt, { ok: false });
    }).then(async () => { await record; await persist(owner, documentId, generation, task.state); });
    tasks.set(taskId, task);
    return task.state;
  };
  return {
    async start(owner: number, documentId: string, generation: string): Promise<KnowledgeExportTaskState> {
      prune();
      const key = `${owner}|${documentId}|${generation}`;
      const taskId = taskIdOf(key);
      const prior = tasks.get(taskId);
      // 进行中或已完整成功（有 PDF）：复用；失败或只完成一部分（带 pdfError、无 pdfUrl，提示「可继续生成」）：允许重新发起（已完成分片在云端复用）。
      if (prior && prior.owner === owner && (prior.state.status === "running" || complete(prior.state))) return prior.state;
      // 同一进程内并发发起：合并为一次（含读持久记录的那段等待）。
      const pending = starting.get(taskId);
      if (pending) return pending;
      const begin = (async () => {
        if (deps.store && !prior) {
          // 重启后：30 分钟内已成功的任务直接返回原结果（签名地址 1 小时有效），不再执行。读失败按没有记录处理。
          const saved = await deps.store.read(knowledgeExportTaskRecordName(owner, taskId)).catch(() => null);
          const state = saved?.value?.state as KnowledgeExportTaskState | undefined;
          if (saved?.value?.kind === "knowledge_export_task_v1" && saved.value.owner === owner && state?.taskId === taskId
            && complete(state) && now() - state.finishedAt <= KEEP_FINISHED_MS) {
            tasks.set(taskId, { owner, key, state, promise: Promise.resolve() });
            return state;
          }
        }
        return launch(owner, documentId, generation, key, taskId);
      })();
      starting.set(taskId, begin);
      try { return await begin; } finally { starting.delete(taskId); }
    },
    /** 查询只返回本人任务；未知（含进程重启后）返回 null，由前台重新发起（发起时读持久记录续看）。 */
    status(owner: number, taskId: string): KnowledgeExportTaskState | null {
      const task = tasks.get(taskId);
      if (!task || task.owner !== owner) return null;
      return task.state;
    },
    /** 测试用：等待任务结束（含记录写入）。 */
    async settled(taskId: string) { await tasks.get(taskId)?.promise; },
  };
}

/** 生产存储：出版证据同一 GCS 桶，条件写入用 ifGenerationMatch（0 = 只在不存在时创建）。 */
export async function gcsTaskStore(): Promise<KnowledgeExportTaskStore> {
  const gcs = await import("./gcs");
  return {
    async read(name) {
      // 读 = 先取 generation 再按该 generation 下载；两步之间对象被改写（持有者每分钟续心跳），旧 generation 下载即 404。
      // 这是「刚被改写」而非读错：重取最新 generation 再读，不把它当成存储故障让等待中的导出失败。
      for (let attempt = 0; ; attempt++) {
        try {
          const got = await gcs.downloadGcsObjectVersioned({ gcsUri: `gs://${gcs.getGcsBucketName()}/${name}` });
          return { value: JSON.parse(got.buffer.toString("utf8")), generation: got.generation };
        } catch (e) {
          if (e instanceof Error && e.message === "gcs_stat_failed:404") return null;
          if (e instanceof Error && e.message === "gcs_download_failed:404" && attempt < 4) continue;
          throw e;
        }
      }
    },
    async write(name, value, ifGeneration) {
      const buffer = Buffer.from(JSON.stringify(value));
      if (ifGeneration === null) {
        const created = await gcs.uploadBufferToGcsIfAbsent({ objectName: name, buffer, contentType: "application/json" });
        return created.created && created.generation ? { ok: true, generation: created.generation } : { ok: false };
      }
      try {
        const written = await gcs.uploadBufferToGcs({ objectName: name, buffer, contentType: "application/json", ifGenerationMatch: ifGeneration });
        if (!written.generation) throw new Error("gcs_upload_no_generation");
        return { ok: true, generation: written.generation };
      } catch (e) {
        if (e instanceof Error && /^gcs_upload_failed:412:/.test(e.message)) return { ok: false };
        throw e;
      }
    },
    async put(name, value) {
      await gcs.uploadBufferToGcs({ objectName: name, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
    },
  };
}

let shared: ReturnType<typeof createKnowledgeExportTasks> | undefined;
let sharedStore: Promise<KnowledgeExportTaskStore> | undefined;
export function knowledgeExportTasks() {
  sharedStore ??= gcsTaskStore();
  const lazy: KnowledgeExportTaskStore = {
    read: async name => (await sharedStore!).read(name),
    write: async (name, value, g) => (await sharedStore!).write(name, value, g),
    put: async (name, value) => (await sharedStore!).put(name, value),
  };
  shared ??= createKnowledgeExportTasks({
    run: async (owner, documentId, generation) => (await import("./knowledgePublicationExport")).exportKnowledgePublication(owner, documentId, generation),
    prefix: async (owner, documentId, generation) => {
      const { loadKnowledgeBookLayoutView } = await import("./knowledgeBookLayout");
      // 与导出共用同一 generation 的视图缓存，几乎不增加耗时。
      return (await loadKnowledgeBookLayoutView(owner, documentId, generation, {}, { cache: true })).prefix;
    },
    store: lazy,
  });
  return shared;
}
