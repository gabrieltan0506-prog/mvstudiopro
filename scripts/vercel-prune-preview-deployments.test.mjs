// 测试只注入内存请求替身；禁止任何真实 fetch。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runPrune } from "./vercel-prune-preview-deployments.mjs";
globalThis.fetch = () => { throw Error("禁止真实网络"); };
const NOW = 1_789_000_000_000;
function fixture(overrides = {}) {
  const calls = [], events = [];
  let projectReads = 0;
  const request = async (path, init) => {
    calls.push([init.method, path]);
    if (path.startsWith("/v9/projects/")) {
      projectReads++;
      return Response.json(overrides.project?.(projectReads) ?? {
        id: "prj_test", name: "mvstudiopro", targets: { production: { id: "prod" }, preview: { id: "preview" } },
      });
    }
    if (path.startsWith("/v6/deployments?")) return Response.json(overrides.list ?? {
      deployments: ["a", "b"].map(uid => ({ uid, target: null, readyState: "READY", created: NOW - 30*86400000 })),
      pagination: { next: null },
    });
    const id = path.split("/").at(-1);
    if (init.method === "GET") return Response.json({ id, projectId: "prj_test", target: null,
      readyState: "READY", alias: [], ...(overrides.detail?.(id) ?? {}) });
    if (init.method === "DELETE") return new Response("{}", { status: overrides.deleteStatus ?? 200 });
    throw Error("未模拟请求");
  };
  return { calls, events, run: (options = {}) => runPrune({ request, audit: async e => { events.push(e); },
    apply: true, now: () => NOW, ...options }), deletes: () => calls.filter(c => c[0] === "DELETE") };
}
test("正常路径每次重读项目和详情，落删除意图及回执", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.deleted, 2);
  assert.equal(f.calls.filter(c => c[1].startsWith("/v9/projects/")).length, 3);
  assert.equal(f.events.filter(e => e.event === "delete-intent").length, 2);
  assert.deepEqual(f.calls.slice(-3).map(c => c[0]), ["GET", "GET", "DELETE"]);
});
test("保护集缺失必须零删除", async () => {
  const f = fixture({ project: () => ({ id: "prj_test", name: "mvstudiopro" }) });
  await assert.rejects(f.run(), /保护集缺失/); assert.equal(f.deletes().length, 0);
});
test("删除前读取保护集失败后停止后续删除", async () => {
  const f = fixture({ project: n => n > 2 ? { id: "prj_test", targets: {} } : undefined });
  await assert.rejects(f.run(), /production/); assert.equal(f.deletes().length, 1);
});
test("第一删后当前preview切到b，第二项保留", async () => {
  const f = fixture({ project: n => n > 2 ? { id: "prj_test", targets: {
    production: { id: "prod" }, preview: { id: "b" } } } : undefined });
  const result = await f.run(); assert.equal(result.deleted, 1); assert.equal(result.skipped, 1);
  assert.equal(f.deletes()[0][1], "/v13/deployments/a");
});
test("已promote的历史production候选不删", async () => {
  const f = fixture({ detail: () => ({ target: "production" }) });
  assert.equal((await f.run()).deleted, 0);
});
test("分支别名仍绑定的preview不删", async () => {
  const f = fixture({ detail: () => ({ alias: ["branch.example.test"] }) });
  assert.equal((await f.run()).deleted, 0);
});
test("缺详情字段或活跃构建均不删", async () => {
  for (const detail of [{ target: undefined }, { alias: undefined }, { readyState: "BUILDING" }]) {
    const f = fixture({ detail: () => detail }); assert.equal((await f.run()).deleted, 0);
  }
});
test("候选项目身份错配停止", async () => {
  const f = fixture({ detail: () => ({ projectId: "other" }) });
  await assert.rejects(f.run(), /归属/); assert.equal(f.deletes().length, 0);
});
test("429只尝试一次即停止，不继续轰炸队列", async () => {
  const f = fixture({ deleteStatus: 429 });
  await assert.rejects(f.run(), /429/); assert.equal(f.deletes().length, 1);
});
test("不完整分页禁止开始删除", async () => {
  const f = fixture({ list: { deployments: [] } });
  await assert.rejects(f.run(), /分页/); assert.equal(f.deletes().length, 0);
});
test("分页重复身份停止，不重复删除", async () => {
  const f = fixture({ list: { deployments: [{ uid: "a" }, { uid: "a" }], pagination: { next: null } } });
  await assert.rejects(f.run(), /重复/); assert.equal(f.deletes().length, 0);
});
test("空跑不发DELETE，保留计划", async () => {
  const f = fixture(); assert.equal((await f.run({ apply: false })).dryRun, true);
  assert.equal(f.deletes().length, 0); assert.equal(f.events[0].event, "plan");
});
test("审计意图写入失败必须零删除", async () => {
  const f = fixture();
  await assert.rejects(f.run({ audit: async e => { if (e.event === "delete-intent") throw Error("disk-full"); } }), /disk-full/);
  assert.equal(f.deletes().length, 0);
});
test("删除数上限保持，剩余明确报告", async () => {
  const f = fixture(); const result = await f.run({ maxDeletes: 1 });
  assert.equal(result.deleted, 1); assert.equal(result.remaining, 1);
});
test("DELETE返回404仍消耗请求预算，不继续删除剩余项", async () => {
  const f = fixture({ deleteStatus: 404 });
  const result = await f.run({ maxDeletes: 1 });
  assert.equal(f.deletes().length, 1);
  assert.equal(result.attempted, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.remaining, 1);
});
test("本机CLI拒绝执行，测试key不会发网络", () => {
  const result = spawnSync(process.execPath, [new URL("./vercel-prune-preview-deployments.mjs", import.meta.url).pathname],
    { encoding: "utf8", env: { VERCEL_TOKEN: "test-key" } });
  assert.equal(result.status, 1); assert.match(result.stderr, /清理中止/);
});
