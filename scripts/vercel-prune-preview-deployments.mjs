#!/usr/bin/env node
/**
 * 定期清理 Vercel 旧预览部署。
 *
 * 0912 起因：Deployment Storage 撑到 309.78 GB / 10 GB（超 30 倍）。976 个部署里 748 个是预览，
 * 每个构建产物约 300 MB 级；保留策略虽已改成「预览 1 周」，存量并不会自己回溯清理。
 *
 * 三道硬闸，任何一条不满足就不删：
 *   ① 只删 target 不是 production 的部署——生产一律不动，回滚点不受影响；
 *   ② 显式排除项目当前的线上生产部署（双保险）；
 *   ③ 必须是超过 KEEP_DAYS 天的，或状态为 ERROR / CANCELED 的。
 *
 * 默认空跑。只有 APPLY=1 才真删。
 * Vercel 删除接口限速为每 10 分钟 200 个（错误码 now-rm），因此分轮执行、轮间等待。
 */

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT = process.env.VERCEL_PROJECT || "mvstudiopro";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 7);
const APPLY = process.env.APPLY === "1";
const ROUND_SIZE = Number(process.env.ROUND_SIZE || 190);
const ROUND_WAIT_MS = Number(process.env.ROUND_WAIT_MS || 11 * 60_000);
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || 3);

if (!TOKEN) {
  console.error("缺少 VERCEL_TOKEN。请在仓库 Secrets 里配置后再跑。");
  process.exit(1);
}

const API = "https://api.vercel.com";
const q = (extra = "") => (TEAM_ID ? `${extra}${extra.includes("?") ? "&" : "?"}teamId=${TEAM_ID}` : extra);
const call = (p, init) =>
  fetch(API + q(p), { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init?.headers || {}) } });

const DAY = 86_400_000;
const isProduction = (d) => (d.target || "preview") === "production";
const fmtDate = (t) => new Date(t).toISOString().slice(0, 10);

async function listAllDeployments() {
  const out = [];
  let until;
  for (let page = 0; page < 60; page += 1) {
    const r = await call(`/v6/deployments?limit=100&projectId=${PROJECT}` + (until ? `&until=${until}` : ""));
    if (!r.ok) {
      console.error("列举部署失败", r.status, (await r.text()).slice(0, 300));
      process.exit(1);
    }
    const j = await r.json();
    const batch = j.deployments || [];
    out.push(...batch);
    if (batch.length < 100) break;
    until = batch[batch.length - 1].created;
  }
  return out;
}

async function resolveLiveProductionIds() {
  const r = await call(`/v9/projects/${PROJECT}`);
  if (!r.ok) return new Set();
  const proj = await r.json();
  const prod = proj?.targets?.production || {};
  return new Set([prod.id, prod.deploymentId].filter(Boolean));
}

const all = await listAllDeployments();
const live = await resolveLiveProductionIds();
const now = Date.now();

const targets = all
  .filter((d) => !isProduction(d))
  .filter((d) => !live.has(d.uid))
  .filter((d) => now - d.created > KEEP_DAYS * DAY || d.readyState === "ERROR" || d.readyState === "CANCELED")
  .sort((a, b) => a.created - b.created);

const productionCount = all.filter(isProduction).length;
const lines = [
  `项目 ${PROJECT}：共 ${all.length} 个部署（生产 ${productionCount}，预览 ${all.length - productionCount}）`,
  `保留天数 ${KEEP_DAYS}，符合清理条件的预览 ${targets.length} 个`,
];
if (targets.length) lines.push(`时间范围 ${fmtDate(targets[0].created)} → ${fmtDate(targets[targets.length - 1].created)}`);

// 闸门自检：目标集合里出现生产或线上部署，立刻停手，绝不继续
const breach = targets.filter((d) => isProduction(d) || live.has(d.uid));
lines.push(`闸门自检：目标里生产或线上部署 ${breach.length} 个（必须为 0）`);
console.log(lines.join("\n"));
if (breach.length) {
  console.error("闸门不通过，停手");
  process.exit(1);
}

if (!APPLY) {
  console.log("\n空跑结束，未删除任何部署。设 APPLY=1 才真删。");
  process.exit(0);
}

let deleted = 0;
const failures = [];
const queue = [...targets];
for (let round = 1; queue.length && round <= MAX_ROUNDS; round += 1) {
  const batch = queue.splice(0, ROUND_SIZE);
  let cursor = 0;
  let rateLimited = false;
  const worker = async () => {
    while (cursor < batch.length) {
      const d = batch[cursor];
      cursor += 1;
      try {
        const r = await call(`/v13/deployments/${d.uid}`, { method: "DELETE" });
        if (r.ok) {
          deleted += 1;
        } else {
          const body = (await r.text()).slice(0, 160);
          if (r.status === 429) {
            rateLimited = true;
            queue.push(d);
          } else {
            failures.push({ uid: d.uid, status: r.status, body });
          }
        }
      } catch (error) {
        failures.push({ uid: d.uid, error: String(error).slice(0, 120) });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(
    `第 ${round} 轮结束：累计删除 ${deleted}，剩余 ${queue.length}，失败 ${failures.length}` +
      (rateLimited ? "（撞限速，已退回队列）" : ""),
  );
  if (queue.length && round < MAX_ROUNDS) {
    console.log(`等待 ${Math.round(ROUND_WAIT_MS / 60_000)} 分钟避开限速…`);
    await new Promise((resolve) => setTimeout(resolve, ROUND_WAIT_MS));
  }
}

console.log(`\n本次删除 ${deleted} 个，失败 ${failures.length} 个，仍剩 ${queue.length} 个（下一班继续）`);
if (failures.length) console.log(JSON.stringify(failures.slice(0, 10), null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "### Vercel 预览部署清理",
      "",
      `- 部署总数：${all.length}（生产 ${productionCount} 一律保留）`,
      `- 本次删除：${deleted}`,
      `- 失败：${failures.length}`,
      `- 仍剩待清：${queue.length}`,
      "",
    ].join("\n"),
  );
}

process.exit(failures.length ? 1 : 0);
