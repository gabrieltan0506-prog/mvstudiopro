#!/usr/bin/env node
// 真实请求仅允许在 Fly 内执行；导出的编排函数供纯离线替身验证。
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { normalizeKeepDays } from "./vercelPruneSelect.mjs";
import { deploymentBranch, selectSupersededPreviews } from "./vercelSupersededPreview.mjs";
import { acquirePruneLock } from "./vercelPruneLock.mjs";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const preview = (value) => record(value) && Object.hasOwn(value, "target")
  && (value.target === null || value.target === "preview");

export async function runPrune({ request, audit, project = "mvstudiopro", apply = false,
  keepDays = 7, failedKeepDays = 1, maxDeletes = 190, now = Date.now,
  beforeDelete = async () => {}, protectedDeploymentIds = [] }) {
  if (typeof request !== "function" || typeof audit !== "function") throw Error("必须提供请求与审计实现");
  if (!text(project)) throw Error("项目标识为空");
  if (!Number.isInteger(maxDeletes) || maxDeletes < 1 || maxDeletes > 190) throw Error("每次最多删除 190 个部署");
  keepDays = normalizeKeepDays(keepDays, 7);
  failedKeepDays = normalizeKeepDays(failedKeepDays, 1);
  if (!Array.isArray(protectedDeploymentIds) || protectedDeploymentIds.some(id => !text(id))) throw Error("保留部署清单无效");
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
    // 空预览项目允许没有 preview 目标；生产保护集仍必须非空。
    for (const key of ["production"]) {
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
  const resolveAliasIds = async () => {
    const ids = new Set();
    let until;
    for (let page = 0; page < 60; page++) {
      const query = new URLSearchParams({ projectId: expectedProjectId, limit: "100" });
      if (until !== undefined) query.set("until", String(until));
      const data = await json(`/v4/aliases?${query}`);
      if (!Array.isArray(data.aliases) || !record(data.pagination)) throw Error("别名分页结构缺失");
      for (const alias of data.aliases) {
        const id = alias?.deploymentId ?? alias?.deployment?.id;
        if (!text(alias?.alias) || !text(id)) throw Error("别名目标无法确认");
        ids.add(id); // 指向404的孤儿alias仍只是保护ID，不创建删除候选。
      }
      const next = data.pagination.next;
      if (next === null) return ids;
      if (!Number.isSafeInteger(next) || next <= 0 || (until !== undefined && next >= until)) throw Error("别名分页游标异常");
      until = next;
    }
    throw Error("别名枚举超过上限");
  };
  const initialLive = await resolveLiveProductionIds();
  for (const id of [...await resolveAliasIds(), ...protectedDeploymentIds]) initialLive.add(id);
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
  const candidates = selectSupersededPreviews([...all.values()], initialLive, now(), failedKeepDays);
  await audit({ event: "plan", projectId: expectedProjectId, apply, total: all.size,
    policy: "superseded-preview-no-minimum-age", failedKeepDays, candidates });
  const result = { candidates: candidates.length, attempted: 0, deleted: 0, skipped: 0, remaining: 0, dryRun: !apply };
  if (!apply) return result;
  for (let i = 0; i < candidates.length; i++) {
    if (result.attempted >= maxDeletes) { result.remaining = candidates.length - i; break; }
    const d = candidates[i];
    await beforeDelete();
    // 必须紧邻每次删除重读，不能沿用枚举前、上一轮或前一个对象的保护集。
    const live = await resolveLiveProductionIds();
    for (const id of [...await resolveAliasIds(), ...protectedDeploymentIds]) live.add(id);
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
    // 替代版本也必须实时存在、READY、同项目同分支，不能只信枚举快照。
    const replacementResponse = await request(`/v13/deployments/${encodeURIComponent(d.replacementId)}`, { method: "GET" });
    if (!replacementResponse.ok && replacementResponse.status !== 404) throw Error("替代部署读取失败");
    const replacement = replacementResponse.status === 404 ? null : await replacementResponse.json();
    const eligible = preview(detail) && Array.isArray(detail.alias) && detail.alias.length === 0
      && detail.readyState !== "BUILDING" && detail.createdAt === d.created
      && deploymentBranch(detail) === d.branch
      && record(replacement) && replacement.id === d.replacementId && replacement.projectId === expectedProjectId
      && replacement.createdAt === d.replacementCreated && deploymentBranch(replacement) === d.branch
      && selectSupersededPreviews([
        { ...detail, uid: d.uid, created: detail.createdAt },
        { ...replacement, uid: replacement.id, created: replacement.createdAt },
      ], live, now(), failedKeepDays).some(row => row.uid === d.uid);
    if (!eligible) {
      result.skipped++;
      await audit({ event: "skip", uid: d.uid, reason: "promoted-aliased-active-or-unknown" });
      continue;
    }
    await audit({ event: "delete-intent", uid: d.uid, replacementId: d.replacementId, reason: d.reason });
    // 404 也消耗一次上游请求预算，不能只统计成功删除而继续无界调用。
    result.attempted++;
    // GET 与 DELETE 之间仍非原子；必须另行保持维护窗口，不能宣称消灭全部竞态。
    const response = await request(`/v13/deployments/${encodeURIComponent(d.uid)}`, { method: "DELETE" });
    await audit({ event: "delete-result", uid: d.uid, status: response.status });
    if (response.status === 404) { result.skipped++; continue; }
    if (!response.ok) throw Error(`删除未成功，停止且不自动重试：HTTP ${response.status}`);
    const check = await request(`/v13/deployments/${encodeURIComponent(d.uid)}`, { method: "GET" });
    await audit({ event: "delete-verification", uid: d.uid, status: check.status });
    if (check.status !== 404) throw Error("删除结果尚未确认，不重试，请核对回执");
    result.deleted++;
  }
  await audit({ event: "finished", ...result });
  return result;
}

export async function executePrune({ apply = false, signal, root = "/data/vercel-prune-audit" } = {}) {
  // 此校验防误运行，不把可伪造的环境变量当作远端鉴权机制。
  if (process.env.FLY_APP_NAME !== "mvstudiopro" || !process.env.FLY_MACHINE_ID) {
    throw Error("真实清理仅允许在 mvstudiopro 的 Fly 服务端运行；本机请运行离线测试");
  }
  mkdirSync(root, { recursive: true });
  const receipt = `${root}/${Date.now()}-${randomUUID()}.jsonl`;
  const audit = async event => appendFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { mode: 0o600, flush: true });
  await audit({ event: "started", apply });
  const token = process.env.VERCEL_TOKEN;
  if (!token) { await audit({ event: "aborted", reason: "missing-token" }); throw Object.assign(Error("Fly 服务端缺少 VERCEL_TOKEN"), { receipt }); }
  const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  let release;
  try { release = acquirePruneLock(root, { machine: process.env.FLY_MACHINE_ID, boot, pid: process.pid, receipt }); }
  catch (error) { await audit({ event: "aborted", reason: "lock-unavailable" }); error.receipt = receipt; throw error; }
  let attemptedDelete = false;
  try {
    const timeout = AbortSignal.timeout(20 * 60_000);
    const request = async (path, init) => {
      if (init.method === "DELETE") attemptedDelete = true;
      const url = new URL(path, "https://api.vercel.com");
      if (url.origin !== "https://api.vercel.com") throw Error("禁止非预期上游");
      url.searchParams.set("teamId", "team_Ufhs4eiVYHpuryokmvrlzHIf");
      return fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([timeout, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
        headers: { Authorization: `Bearer ${token}` } });
    };
    const beforeDelete = async () => {
      // 按状态查询是否存在在途构建，不能只看最近一页未筛选的部署。
      for (const state of ["BUILDING", "QUEUED", "INITIALIZING"]) {
        const query = new URLSearchParams({ projectId: "prj_7y3mwOmGqVDHRkQYWZLmmBinkSvI", state, limit: "1" });
        const response = await request(`/v6/deployments?${query}`, { method: "GET" });
        if (!response.ok) throw Error(`构建状态读取失败：HTTP ${response.status}`);
        const body = await response.json();
        if (!record(body) || !Array.isArray(body.deployments)) throw Error("构建状态结构未知");
        if (body.deployments.length) {
          await audit({ event: "deferred", reason: "active-deployment", state });
          throw Object.assign(Error("存在在途部署，延期清理"), { code: "PRUNE_DEFERRED" });
        }
      }
    };
    await beforeDelete();
    const result = await runPrune({ request, audit, apply,
      project: "prj_7y3mwOmGqVDHRkQYWZLmmBinkSvI", beforeDelete,
      failedKeepDays: 1, protectedDeploymentIds: JSON.parse(readFileSync(new URL("../ops/vercel-preview-protection.json", import.meta.url), "utf8")).deploymentIds });
    console.log(JSON.stringify({ ...result, receipt }));
    return { ...result, receipt };
  } catch (error) {
    await audit({ event: "aborted", message: "执行中止；按同一回执逐项核对，勿盲目重试" });
    error.attemptedDelete = attemptedDelete;
    error.receipt = receipt;
    throw error;
  } finally {
    release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--maintenance-window-confirmed")) {
    console.error("清理中止：手动真删须确认维护窗口"); process.exitCode = 1;
  } else executePrune({ apply }).catch(() => { console.error("清理中止。核对 Fly 审计回执；未自动重试、未导出凭证。"); process.exitCode = 1; });
}
