#!/usr/bin/env node
/**
 * 冷备「本轮让路」判定（0911）。
 *
 * 背景：两类情况本来就不该判成备份失败——
 *   1) 前台平台任务占着机器，等满 30 分钟仍未让开（0910 18:00 那轮就是知识卡长跑）；
 *   2) main 刚合并、部署还在路上，正式机镜像比工作流旧（0911 07:42 那轮）。
 * 这两种下个班次自然会好，旧写法却直接 exit 1 标红，连着几轮红之后
 * 真正的故障反而看不出来。
 *
 * 但「让路」绝不能变成无声停摆：本脚本会查这条工作流最近一次**成功**的时间，
 * 超过阈值（默认 24 小时）就仍然判失败，并说清已经多久没有成功备份。
 *
 * 用法：node scripts/growth-backup-defer.mjs "<让路原因>" [最长容忍小时数]
 * 退出码：0=本轮让路（下个班次重试）；1=让路太久，按失败处理。
 */
import { appendFileSync } from "node:fs";

const reason = String(process.argv[2] || "未说明原因").trim();
const maxStaleHours = Math.max(1, Number(process.argv[3]) || 24);

const repo = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const workflow = process.env.GITHUB_WORKFLOW_REF?.split("/").pop()?.split("@")[0]
  || "growth-backup.yml";
const runId = process.env.GITHUB_RUN_ID || "";

/** 最近一次成功完成的本工作流运行时间；查不到返回 null（按未知处理） */
async function lastSuccessAt() {
  if (!repo || !token) return null;
  // GITHUB_API_URL 由 Actions 注入；本地/测试可指向桩服务
  const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const url = `${api}/repos/${repo}/actions/workflows/${workflow}/runs`
    + `?status=success&per_page=1&exclude_pull_requests=true`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "growth-backup-defer",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const run = json?.workflow_runs?.[0];
    // 排除本次运行自己（理论上不会是 success，稳妥起见）
    if (!run || String(run.id) === runId) return null;
    const at = Date.parse(run.updated_at || run.created_at || "");
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function summary(line) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `${line}\n`);
  } catch {
    /* 摘要写不了不影响判定 */
  }
}

const successAt = await lastSuccessAt();
const hours = successAt === null ? null : (Date.now() - successAt) / 3_600_000;

if (hours === null) {
  // 查不到「上次成功」就不敢让路：宁可标红让人看一眼，也不能无声停摆
  console.error(`::error::冷备本轮需要让路（${reason}），但查不到上次成功备份的时间，按失败处理`);
  summary(`## 冷备失败\n\n让路原因：${reason}\n\n查不到上次成功备份时间，未敢静默让路。`);
  process.exit(1);
}

if (hours > maxStaleHours) {
  console.error(
    `::error::冷备已连续让路，最近一次成功是 ${hours.toFixed(1)} 小时前（阈值 ${maxStaleHours} 小时）：${reason}`,
  );
  summary(
    `## 冷备失败\n\n让路原因：${reason}\n\n最近一次成功备份在 ${hours.toFixed(1)} 小时前，`
    + `超过 ${maxStaleHours} 小时阈值，不能再让路。`,
  );
  process.exit(1);
}

console.log(`::warning::冷备本轮让路：${reason}（最近一次成功 ${hours.toFixed(1)} 小时前，下个班次重试）`);
summary(
  `## 冷备本轮让路\n\n原因：${reason}\n\n最近一次成功备份在 ${hours.toFixed(1)} 小时前，`
  + `仍在 ${maxStaleHours} 小时阈值内，下个班次自动重试。`,
);
process.exit(0);
