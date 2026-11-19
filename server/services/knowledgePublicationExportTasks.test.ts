import { expect, it, describe, vi } from "vitest";
import { createKnowledgeExportTasks, knowledgeExportLeaseName, knowledgeExportTaskRecordName, KNOWLEDGE_EXPORT_LEASE_STALE_MS, type KnowledgeExportTaskStore } from "./knowledgePublicationExportTasks";

const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const result = { htmlUrl: "h", htmlBytes: 1, chapters: 1, pdfUrl: "p", totalPages: 3, imagePages: 1 } as any;

it("发起即返回任务标识；同一账号+稿件+版本重复发起复用进行中任务；完成后查询拿到结果", async () => {
  const gate = deferred<any>(); let runs = 0;
  const tasks = createKnowledgeExportTasks({ run: async () => { runs++; return gate.promise; } });
  const first = await tasks.start(7, "doc", "10");
  expect(first.status).toBe("running");
  expect((await tasks.start(7, "doc", "10")).taskId).toBe(first.taskId);
  expect(runs).toBe(1);
  expect(tasks.status(7, first.taskId)?.status).toBe("running");
  gate.resolve(result); await tasks.settled(first.taskId);
  expect(tasks.status(7, first.taskId)).toMatchObject({ status: "succeeded", result });
  // 成功后再发起（刷新续看）直接复用，不重跑。
  expect((await tasks.start(7, "doc", "10")).status).toBe("succeeded"); expect(runs).toBe(1);
});
it("查询只返回本人任务；未知任务为 null（前台据此重新发起）", async () => {
  const tasks = createKnowledgeExportTasks({ run: () => new Promise(() => undefined) });
  const state = await tasks.start(7, "doc", "10");
  expect(tasks.status(8, state.taskId)).toBeNull();
  expect(tasks.status(7, "0".repeat(32))).toBeNull();
});
it("失败返回业务提示且允许重新发起；同一成品目录的新版本任务等待进行中的那一次，不重复渲染", async () => {
  let runs = 0; const gate = deferred<any>();
  const tasks = createKnowledgeExportTasks({ run: async () => { runs++; if (runs === 1) throw Error("pdf worker gs://secret 超时"); return gate.promise; }, prefix: async () => "same-product" });
  const failed = await tasks.start(7, "doc", "10"); await tasks.settled(failed.taskId);
  const state = tasks.status(7, failed.taskId)!;
  expect(state.status).toBe("failed");
  expect(JSON.stringify(state)).not.toContain("gs://");
  const retry = await tasks.start(7, "doc", "10"); expect(retry.status).toBe("running");
  const other = await tasks.start(7, "doc", "11");
  expect(other.taskId).not.toBe(retry.taskId);
  gate.resolve(result);
  await tasks.settled(retry.taskId); await tasks.settled(other.taskId);
  expect(runs).toBe(2);
  expect(tasks.status(7, other.taskId)).toMatchObject({ status: "succeeded" });
});

/** 带 generation 的内存版存储，可注入失败；多个「进程」共用同一份即模拟多机/重启。 */
function memoryStore() {
  const objects = new Map<string, { value: any; generation: string }>();
  let gen = 0;
  const fail = { read: 0, write: 0, put: 0 };
  const store: KnowledgeExportTaskStore & { objects: typeof objects; fail: typeof fail } = {
    objects, fail,
    async read(name) { if (fail.read > 0) { fail.read--; throw Error("fetch failed"); } const o = objects.get(name); return o ? { value: structuredClone(o.value), generation: o.generation } : null; },
    async write(name, value, ifGeneration) {
      if (fail.write > 0) { fail.write--; throw Error("gcs_upload_failed:503:{}"); }
      const cur = objects.get(name);
      if (ifGeneration === null ? !!cur : cur?.generation !== ifGeneration) return { ok: false };
      const generation = String(++gen); objects.set(name, { value: structuredClone(value), generation }); return { ok: true, generation };
    },
    async put(name, value) { if (fail.put > 0) { fail.put--; throw Error("ENOSPC"); } objects.set(name, { value: structuredClone(value), generation: String(++gen) }); },
  };
  return store;
}
/** 假时钟：sleep 推进时钟并让出事件循环；心跳由测试手动触发。 */
function clock() {
  const c = { t: 1_000_000, beats: [] as (() => void)[] };
  return Object.assign(c, {
    now: () => c.t,
    sleep: async (ms: number) => { c.t += ms; await new Promise(r => setImmediate(r)); },
    every: (_ms: number, fn: () => void) => { c.beats.push(fn); return () => { c.beats.splice(c.beats.indexOf(fn), 1); }; },
  });
}
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
/** 假导出：成品清单在即复用不渲染；记录同时在跑的渲染路数。 */
function fakeExport() {
  const e = { renders: 0, calls: 0, active: 0, peak: 0, done: new Set<string>(), gates: [] as ReturnType<typeof deferred<void>>[] };
  return Object.assign(e, {
    run: async (_o: number, doc: string) => {
      e.calls++;
      if (e.done.has(doc)) return result;
      e.renders++; e.active++; e.peak = Math.max(e.peak, e.active);
      const gate = deferred<void>(); e.gates.push(gate);
      try { await gate.promise; e.done.add(doc); return result; } finally { e.active--; }
    },
  });
}

describe("E4 导出任务持久化与渲染租约（GCS 证据桶，条件写入）", () => {
  it("已完成的导出跨重启保留：新进程用同一稿件版本发起即直接返回原结果，不再执行", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const a = createKnowledgeExportTasks({ run: ex.run, store, holder: "A", now: c.now, sleep: c.sleep, every: c.every });
    const s = await a.start(7, "doc", "10"); await flush(); ex.gates[0]!.resolve(); await a.settled(s.taskId);
    expect(store.objects.get(knowledgeExportTaskRecordName(7, s.taskId))!.value.state.status).toBe("succeeded");
    expect(store.objects.get(knowledgeExportLeaseName(7, "7|doc|10"))!.value.status).toBe("succeeded");
    // 「重启」：全新模块状态，只剩存储。
    const b = createKnowledgeExportTasks({ run: ex.run, store, holder: "B", now: c.now, sleep: c.sleep, every: c.every });
    expect(b.status(7, s.taskId)).toBeNull(); // 前台见 missing → 重新发起
    const again = await b.start(7, "doc", "10");
    expect(again).toMatchObject({ status: "succeeded", taskId: s.taskId, result });
    expect(ex.calls).toBe(1);
    // 他人账号读不到别人的记录（路径按账号分目录，记录另校验账号）：账号 8 是新任务。
    const other = await b.start(8, "doc", "10"); await b.settled(other.taskId);
    expect(store.objects.has(knowledgeExportTaskRecordName(8, s.taskId))).toBe(false);
    expect(other.taskId).not.toBe(s.taskId); expect(ex.calls).toBe(2);
    // 超过 30 分钟（签名地址将过期）：重新执行一次——成品清单已在，不渲染。
    c.t += 31 * 60_000;
    const c2 = createKnowledgeExportTasks({ run: ex.run, store, holder: "C", now: c.now, sleep: c.sleep, every: c.every });
    const fresh = await c2.start(7, "doc", "10"); await c2.settled(fresh.taskId);
    expect(c2.status(7, fresh.taskId)?.status).toBe("succeeded");
    expect(ex.calls).toBe(3); expect(ex.renders).toBe(1); // 后两次均复用已在的成品，不渲染
  });

  it("两台机器同时发起同一导出：只渲染一次；后到的等待持有者结束后复用成品", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const opts = { run: ex.run, store, now: c.now, sleep: c.sleep, every: c.every, prefix: async () => "exports/abc" };
    const a = createKnowledgeExportTasks({ ...opts, holder: "A" }), b = createKnowledgeExportTasks({ ...opts, holder: "B" });
    const [sa, sb] = await Promise.all([a.start(7, "doc", "10"), b.start(7, "doc", "10")]);
    await flush();
    expect(ex.renders).toBe(1);
    // A 持续心跳期间 B 一直等，即使等了远超失联窗口也不接管。
    for (let i = 0; i < 30; i++) { c.beats.forEach(f => f()); await c.sleep(60_000); await flush(5); }
    expect(ex.renders).toBe(1); expect(ex.calls).toBe(1);
    expect(b.status(7, sb.taskId)?.status).toBe("running");
    ex.gates[0]!.resolve();
    await a.settled(sa.taskId); await b.settled(sb.taskId);
    expect(a.status(7, sa.taskId)?.status).toBe("succeeded");
    expect(b.status(7, sb.taskId)?.status).toBe("succeeded");
    expect(ex.renders).toBe(1); expect(ex.peak).toBe(1); expect(ex.calls).toBe(2);
  });

  it("同一进程内并发重复发起：合并为一个任务、一次执行", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const a = createKnowledgeExportTasks({ run: ex.run, store, holder: "A", now: c.now, sleep: c.sleep, every: c.every });
    const states = await Promise.all([a.start(7, "doc", "10"), a.start(7, "doc", "10"), a.start(7, "doc", "10")]);
    expect(new Set(states.map(s => s.taskId)).size).toBe(1);
    await flush(); expect(ex.calls).toBe(1);
    ex.gates[0]!.resolve(); await a.settled(states[0]!.taskId);
  });

  it("执行中进程被杀：租约停在 running；失联满 10 分钟前不接管，满后新进程条件接管并重试，且只有一路", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const dead = createKnowledgeExportTasks({ run: ex.run, store, holder: "A", now: c.now, sleep: c.sleep, every: () => () => undefined });
    await dead.start(7, "doc", "10"); await flush();
    expect(ex.renders).toBe(1); // A 在渲染中「死掉」：门永不打开，心跳不再写。
    const diedAt = c.t;
    const b = createKnowledgeExportTasks({ run: ex.run, store, holder: "B", now: c.now, sleep: c.sleep, every: c.every });
    const sb = await b.start(7, "doc", "10");
    // B 等待：每次轮询推进 5 秒；失联未满 10 分钟时 B 不执行。
    while (ex.calls < 2) { await flush(2); if (c.t - diedAt > KNOWLEDGE_EXPORT_LEASE_STALE_MS + 60_000) break; }
    expect(ex.calls).toBe(2);
    expect(c.t - diedAt).toBeGreaterThanOrEqual(KNOWLEDGE_EXPORT_LEASE_STALE_MS);
    expect(c.t - diedAt).toBeLessThan(KNOWLEDGE_EXPORT_LEASE_STALE_MS + 10_000);
    expect(store.objects.get(knowledgeExportLeaseName(7, "7|doc|10"))!.value.holder).toBe("B");
    ex.gates[1]!.resolve(); await b.settled(sb.taskId);
    expect(b.status(7, sb.taskId)?.status).toBe("succeeded");
    expect(store.objects.get(knowledgeExportLeaseName(7, "7|doc|10"))!.value).toMatchObject({ holder: "B", status: "succeeded" });
  });

  it("心跳写失败不算续期：持有者连续写不进心跳超过失联窗口即可被接管；原持有者心跳条件写入随即失败、不再覆盖新持有者的租约", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const a = createKnowledgeExportTasks({ run: ex.run, store, holder: "A", now: c.now, sleep: c.sleep, every: c.every });
    const sa = await a.start(7, "doc", "10"); await flush();
    const name = knowledgeExportLeaseName(7, "7|doc|10");
    const beat = async () => { c.beats.forEach(f => f()); await flush(5); };
    store.fail.write = 1; c.t += 60_000; await beat(); // 一次心跳写失败
    expect(store.objects.get(name)!.value.heartbeatAt).toBeLessThan(c.t - 50_000);
    c.t += 60_000; await beat(); // 恢复后续期成功
    expect(store.objects.get(name)!.value.heartbeatAt).toBe(c.t);
    // 存储整段写不进去 11 分钟：B 接管。
    store.fail.write = 1000;
    const b = createKnowledgeExportTasks({ run: ex.run, store, holder: "B", now: c.now, sleep: c.sleep, every: () => () => undefined });
    const startB = b.start(7, "doc", "10");
    store.fail.write = 0; // 存储恢复，只是 A 的心跳一直没写进（模拟）
    const quiet = c.t;
    while (ex.calls < 2 && c.t - quiet < 12 * 60_000) await flush(2);
    expect(store.objects.get(name)!.value.holder).toBe("B");
    await beat(); // A 的心跳：条件写入失败 → 标记失去租约
    expect(store.objects.get(name)!.value.holder).toBe("B");
    ex.gates[0]!.resolve(); await a.settled(sa.taskId);
    expect(store.objects.get(name)!.value.holder).toBe("B"); // A 结束也不释放（不覆盖 B）
    ex.gates[1]!.resolve(); await b.settled((await startB).taskId);
  });

  it("读租约出错：任务失败（业务提示、无地址），可重新发起；任务记录写失败只记日志不影响结果", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = createKnowledgeExportTasks({ run: ex.run, store, holder: "A", now: c.now, sleep: c.sleep, every: c.every });
    store.fail.read = 2; // 一次是读任务记录（按无记录处理），一次是读租约（失败）
    const s = await a.start(7, "doc", "10"); await a.settled(s.taskId);
    expect(a.status(7, s.taskId)?.status).toBe("failed");
    expect(ex.calls).toBe(0);
    store.fail.put = 2;
    const again = await a.start(7, "doc", "10"); await flush(); ex.gates[0]!.resolve(); await a.settled(again.taskId);
    expect(a.status(7, again.taskId)?.status).toBe("succeeded");
    expect(warn.mock.calls.some(([m]) => String(m).includes("task record not written"))).toBe(true);
    warn.mockRestore();
  });

  it("本进程上次没释放掉的 running 租约：本进程未在渲染时不必等失联，直接条件接管", async () => {
    const store = memoryStore(), c = clock(), ex = fakeExport();
    const a = createKnowledgeExportTasks({ run: ex.run, store, holder: "A", now: c.now, sleep: c.sleep, every: c.every, prefix: async (_o, _d, g) => `exports/${g === "10" ? "x" : "x"}` });
    const s = await a.start(7, "doc", "10"); await flush();
    store.fail.write = 1; // 释放写失败
    ex.gates[0]!.resolve(); await a.settled(s.taskId);
    expect(store.objects.get(knowledgeExportLeaseName(7, "7|exports/x"))!.value.status).toBe("running");
    const t0 = c.t;
    const next = await a.start(7, "doc", "11"); await flush(); await a.settled(next.taskId);
    expect(a.status(7, next.taskId)?.status).toBe("succeeded");
    expect(c.t - t0).toBeLessThan(60_000);
  });
});
