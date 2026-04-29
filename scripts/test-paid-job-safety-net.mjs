#!/usr/bin/env node
/**
 * 自测脚本：验证 paid-job-safety-net-v2 两个核心商业护栏：
 *  1. maintenanceMode.assertMaintenanceOff 的 fail-open 行为（flag 不存在 → 不抛）
 *  2. paidJobLedger.refundCreditsOnFailure 的 user_cancelled_no_refund 分支：
 *      hold 标 settled、creditsRefunded=0、不调 refundCredits
 *
 * 跑法：
 *   node --experimental-strip-types scripts/test-paid-job-safety-net.mjs
 *
 * 注意：本脚本通过观察 hold 文件落盘的最终状态来验证「refundCredits 是否
 *       被调用」——因为 user_cancelled_no_refund 分支会在调用 credits.ts
 *       之前 early return，所以 hold.status=settled / creditsRefunded=0
 *       即可证明 refundCredits 路径没有被走到。
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mvs-safety-net-"));
const ledgerDir = path.join(tmpRoot, "active-jobs");
const auditDir = path.join(tmpRoot, "audit");
const flagPath = path.join(tmpRoot, "maintenance.flag");

process.env.PAID_JOB_LEDGER_DIR = ledgerDir;
process.env.PAID_JOB_AUDIT_DIR = auditDir;
process.env.MAINTENANCE_FLAG_PATH = flagPath;

let passed = 0;
let failed = 0;
const ok = (name) => { passed++; console.log(`  ✅ ${name}`); };
const fail = (name, detail) => { failed++; console.log(`  ❌ ${name}: ${detail}`); };

// ── Test 1: maintenanceMode fail-open（flag 不存在 → assertMaintenanceOff 不抛） ──
console.log("\n[1/3] maintenanceMode fail-open（flag 文件不存在不能抛错）");
{
  await fs.unlink(flagPath).catch(() => {});
  const mod = await import("../server/services/maintenanceMode.ts");
  try {
    await mod.assertMaintenanceOff("test");
    ok("flag 不存在时 assertMaintenanceOff 不抛");
  } catch (e) {
    fail("flag 不存在时 assertMaintenanceOff 抛了错", e?.message || String(e));
  }
  const state = await mod.getMaintenanceState();
  if (state.enabled === false) ok("flag 不存在时 enabled=false");
  else fail("flag 不存在时 enabled 应为 false", JSON.stringify(state));

  // 额外测试：写一个损坏的 JSON 也得 fail-open
  await fs.writeFile(flagPath, "not-a-json{{{}}");
  const broken = await mod.getMaintenanceState();
  if (broken.enabled === false) ok("flag JSON 损坏时 enabled=false（fail-open）");
  else fail("flag JSON 损坏时 enabled 应为 false", JSON.stringify(broken));
  await fs.unlink(flagPath).catch(() => {});
}

// ── Test 2: maintenanceMode 开启 → assertMaintenanceOff 抛 SERVICE_UNAVAILABLE ──
console.log("\n[2/3] maintenanceMode 开启 → assertMaintenanceOff 抛 SERVICE_UNAVAILABLE");
{
  const mod = await import("../server/services/maintenanceMode.ts");
  await mod.enableMaintenance("test:user", "DB 切换 · 自测");
  const state = await mod.getMaintenanceState();
  if (state.enabled === true && state.reason === "DB 切换 · 自测") ok("enableMaintenance 写入成功");
  else fail("enableMaintenance 状态不对", JSON.stringify(state));
  try {
    await mod.assertMaintenanceOff("test");
    fail("flag 开启时 assertMaintenanceOff 没抛", "应抛 SERVICE_UNAVAILABLE");
  } catch (e) {
    if (e?.code === "SERVICE_UNAVAILABLE" || /SERVICE_UNAVAILABLE/.test(String(e))) {
      ok("flag 开启时抛 SERVICE_UNAVAILABLE");
    } else if (/系统正在升级维护/.test(e?.message || "")) {
      ok(`flag 开启时抛带「系统正在升级维护」的错误: ${e?.message}`);
    } else {
      fail("抛错但 code 不是 SERVICE_UNAVAILABLE", e?.code || e?.message || String(e));
    }
  }
  await mod.disableMaintenance("test:user");
  const after = await mod.getMaintenanceState();
  if (after.enabled === false) ok("disableMaintenance 后 enabled=false");
  else fail("disableMaintenance 后 enabled 应为 false", JSON.stringify(after));
}

// ── Test 3: refundCreditsOnFailure 的 user_cancelled_no_refund 分支 ──
//   关键验证点：
//     a) 返回 { refunded:false, creditsRefunded:0, status:"settled" }
//     b) 落盘 hold.status="settled" / refundReason="user_cancelled_no_refund"
//        / creditsRefunded=0
//     c) audit 日志里有 action="userCancelNoRefund" 的条目
//     d) 第二次重复调用是幂等 no-op（status 已经是 settled）
console.log("\n[3/3] refundCreditsOnFailure(reason='user_cancelled_no_refund') 不退积分");
{
  const ledgerPath = path.resolve("./server/services/paidJobLedger.ts");
  const ledger = await import(ledgerPath);
  const jobId = `test-job-${Date.now()}`;
  await ledger.registerActiveJob({
    jobId,
    taskType: "deepResearch",
    userId: 99999,
    creditsBilled: 4500,
    action: "自测·上帝视角研报（4500点）",
  });
  console.log(`  · 注册 hold jobId=${jobId} creditsBilled=4500`);

  const r = await ledger.refundCreditsOnFailure(
    jobId,
    "deepResearch",
    "user_cancelled_no_refund",
    "自测主动取消",
  );

  if (r.refunded === false && r.creditsRefunded === 0 && r.status === "settled") {
    ok("返回 refunded=false / creditsRefunded=0 / status=settled");
  } else {
    fail("返回值不符", JSON.stringify(r));
  }

  // hold 落盘状态
  const hold = await ledger.readActiveJob(jobId, "deepResearch");
  if (hold?.status === "settled") ok("hold.status === 'settled'（不是 refunded）");
  else fail("hold.status 不对", JSON.stringify(hold?.status));
  if (hold?.creditsRefunded === 0) ok("hold.creditsRefunded === 0（真的没退）");
  else fail("hold.creditsRefunded 不对", JSON.stringify(hold?.creditsRefunded));
  if (hold?.refundReason === "user_cancelled_no_refund") ok("hold.refundReason === 'user_cancelled_no_refund'");
  else fail("hold.refundReason 不对", JSON.stringify(hold?.refundReason));
  if (hold?.refundDetail) ok(`hold.refundDetail 已记录: ${hold.refundDetail}`);
  else fail("hold.refundDetail 应有内容", "应至少包含『主动取消，按规则不退还积分』兜底文案");

  // 第二次调用的幂等性
  const r2 = await ledger.refundCreditsOnFailure(
    jobId,
    "deepResearch",
    "user_cancelled_no_refund",
    "重复调用",
  );
  if (r2.status === "settled" && r2.refunded === false && r2.creditsRefunded === 0) {
    ok("重复调用幂等 no-op（仍返回 settled / refunded=false / 0）");
  } else {
    fail("重复调用结果不符", JSON.stringify(r2));
  }

  // audit jsonl 里应该有 userCancelNoRefund 条目
  const auditFiles = await fs.readdir(auditDir).catch(() => []);
  let foundAuditEntry = false;
  for (const f of auditFiles) {
    if (!f.endsWith(".jsonl")) continue;
    const content = await fs.readFile(path.join(auditDir, f), "utf-8").catch(() => "");
    if (content.includes('"action":"userCancelNoRefund"')) {
      foundAuditEntry = true;
      break;
    }
  }
  if (foundAuditEntry) ok("audit 日志写入了 action='userCancelNoRefund' 条目");
  else fail("audit 日志缺少 userCancelNoRefund 条目", `auditDir=${auditDir} files=${auditFiles.join(",")}`);
}

console.log("\n──────── 自测总览 ────────");
console.log(`  通过: ${passed}`);
console.log(`  失败: ${failed}`);

await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

process.exit(failed > 0 ? 1 : 0);
