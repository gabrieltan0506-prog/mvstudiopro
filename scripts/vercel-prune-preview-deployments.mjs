#!/usr/bin/env node
// 真实请求仅允许在 Fly 内执行；导出的编排函数供纯离线替身验证。
import { appendFileSync, mkdirSync, rmdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { normalizeKeepDays, selectPrunableDeployments } from "./vercelPruneSelect.mjs";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const preview = (value) => record(value) && Object.hasOwn(value, "target")
  && (value.target === null || value.target === "preview");

export async function runPrune({ request, audit, project = "mvstudiopro", apply = false,
  keepDays = 7, failedKeepDays = 1, maxDeletes = 190, now = Date.now }) {
  if (typeof request !== "function" || typeof audit !== "function") throw Error("必须提供请求与审计实现");
  if (!text(project)) throw Error("项目标识为空");
  if (!Number.isInteger(maxDeletes) || maxDeletes < 1 || maxDeletes > 190) throw Error("每次最多删除 190 个部署");
  keepDays = normalizeKeepDays(keepDays, 7);
  failedKeepDays = normalizeKeepDays(failedKeepDays, 1);
  let expectedProjectId;
  const json = async (path) => {
    const response = await request(path, { method: "GET" });
    if (!response.ok) throw Error(`读取失败，停止清理：HTTP ${response.status}`);
    const body = await response.json();
    if (!record(body)) throw Error("响应不是对象，停止清理");
    return body;
  };
  const resolveLiveProductionIds = async () => {
    const p = await json(`/v9/projects/${encodeURIComponent(expectedProjectId || project)}`);
    if (!text(p.id) || (expectedProjectId ? p.id !== expectedProjectId : p.id !== project && p.name !== project)) {
      throw Error("项目身份不匹配，停止清理");
    }
    if (!record(p.targets)) throw Error("当前部署保护集缺失，停止清理");
    // 这是当前同时有 production/preview 项目的保守清理策略，并非官方必填 schema。
    for (const key of ["production", "preview"]) {
      if (!record(p.targets[key]) || !text(p.targets[key].id)) {
        throw Error(`无法确认当前 ${key} 部署，停止清理`);
      }
    }
    const ids = new Set();
    for (const target of Object.values(p.targets)) {
      if (!record(target) || !text(target.id)) throw Error("保护集包含无法识别的目标，停止清理");
      ids.add(target.id);
    }
    expectedProjectId = p.id;
    return ids;
  };
  const initialLive = await resolveLiveProductionIds();
  const all = new Map();
  let until;
  let finished = false;
  for (let page = 0; page < 60; page++) {
    const query = new URLSearchParams({ projectId: expectedProjectId, limit: "100" });
    if (until !== undefined) query.set("until", String(until));
    const data = await json(`/v6/deployments?${query}`);
    if (!Array.isArray(data.deployments) || !record(data.pagination)) throw Error("部署分页结构缺失");
    for (const d of data.deployments) {
      if (!record(d) || !text(d.uid)) throw Error("部署身份缺失");
      if (all.has(d.uid)) throw Error("分页出现重复部署，停止清理");
      all.set(d.uid, d);
    }
    const next = data.pagination.next;
    if (next === null) { finished = true; break; }
    if (!Number.isSafeInteger(next) || next <= 0 || (until !== undefined && next >= until)) {
      throw Error("分页游标异常，停止清理");
    }
    until = next;
  }
  if (!finished) throw Error("部署枚举超过上限，停止清理");
  const selection = selectPrunableDeployments({ deployments: [...all.values()],
    liveProductionIds: initialLive, keepDays, failedKeepDays, now: now() });
  if (selection.breach.length) throw Error("候选集合闸门失败");
  // 只输出审计必要字段，绝不持久化上游 deployment 的 env 等私密字段。
  const candidates = selection.targets.filter(preview).map(d => ({ uid: d.uid, created: d.created }));
  await audit({ event: "plan", projectId: expectedProjectId, apply, total: all.size,
    keepDays, failedKeepDays, candidates });
  const result = { candidates: candidates.length, deleted: 0, skipped: 0, remaining: 0, dryRun: !apply };
  if (!apply) return result;
  for (let i = 0; i < candidates.length; i++) {
    if (result.deleted >= maxDeletes) { result.remaining = candidates.length - i; break; }
    const d = candidates[i];
    // 必须紧邻每次删除重读，不能沿用枚举前、上一轮或前一个对象的保护集。
    const live = await resolveLiveProductionIds();
    if (live.has(d.uid)) {
      result.skipped++;
      await audit({ event: "skip", uid: d.uid, reason: "current-target" });
      continue;
    }
    const detailResponse = await request(`/v13/deployments/${encodeURIComponent(d.uid)}`, { method: "GET" });
    if (detailResponse.status === 404) {
      result.skipped++;
      await audit({ event: "skip", uid: d.uid, reason: "already-absent" });
      continue;
    }
    if (!detailResponse.ok) throw Error(`候选复核失败，停止清理：HTTP ${detailResponse.status}`);
    const detail = await detailResponse.json();
    if (!record(detail) || detail.id !== d.uid || detail.projectId !== expectedProjectId) {
      throw Error("候选部署身份或项目归属无法确认，停止清理");
    }
    // 保留任何已绑定别名的部署，包括分支预览；详情缺失别名信息时也保留。
    const eligible = preview(detail) && Array.isArray(detail.alias) && detail.alias.length === 0
      && ["READY", "ERROR", "CANCELED"].includes(detail.readyState)
      && selectPrunableDeployments({ deployments: [{ uid: d.uid, created: d.created,
        target: detail.target, readyState: detail.readyState }], liveProductionIds: live,
        keepDays, failedKeepDays, now: now() }).targets.length === 1;
    if (!eligible) {
      result.skipped++;
      await audit({ event: "skip", uid: d.uid, reason: "promoted-aliased-active-or-unknown" });
      continue;
    }
    await audit({ event: "delete-intent", uid: d.uid });
    // GET 与 DELETE 之间仍非原子；必须另行保持维护窗口，不能宣称消灭全部竞态。
    const response = await request(`/v13/deployments/${encodeURIComponent(d.uid)}`, { method: "DELETE" });
    await audit({ event: "delete-result", uid: d.uid, status: response.status });
    if (response.status === 404) { result.skipped++; continue; }
    if (!response.ok) throw Error(`删除未成功，停止且不自动重试：HTTP ${response.status}`);
    result.deleted++;
  }
  await audit({ event: "finished", ...result });
  return result;
}

async function main() {
  // 此校验防误运行，不把可伪造的环境变量当作远端鉴权机制。
  if (process.env.FLY_APP_NAME !== "mvstudiopro" || !process.env.FLY_MACHINE_ID) {
    throw Error("真实清理仅允许在 mvstudiopro 的 Fly 服务端运行；本机请运行离线测试");
  }
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--maintenance-window-confirmed")) {
    throw Error("真删前必须确认无发布/promote 在途，并在执行全程维持维护窗口");
  }
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw Error("Fly 服务端缺少 VERCEL_TOKEN，停止；不得导出或在本机配置");
  const root = "/data/vercel-prune-audit";
  mkdirSync(root, { recursive: true });
  const lock = `${root}/active.lock`;
  // 同一 Fly 卷上防重复清理；异常退出留下锁须先核实旧任务状态，不自动抢锁。
  mkdirSync(lock);
  const receipt = `${root}/${Date.now()}-${randomUUID()}.jsonl`;
  const audit = async event => appendFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { mode: 0o600, flush: true });
  try {
    const request = async (path, init) => {
      const url = new URL(path, "https://api.vercel.com");
      if (url.origin !== "https://api.vercel.com") throw Error("禁止非预期上游");
      if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
      return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}` } });
    };
    const result = await runPrune({ request, audit, apply,
      keepDays: process.env.KEEP_DAYS, failedKeepDays: process.env.FAILED_KEEP_DAYS });
    console.log(JSON.stringify({ ...result, receipt }));
  } catch (error) {
    await audit({ event: "aborted", message: "执行中止；按同一回执逐项核对，勿盲目重试" });
    throw error;
  } finally {
    rmdirSync(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("清理中止。核对 Fly 审计回执；未自动重试、未导出凭证。"); process.exitCode = 1; });
}
