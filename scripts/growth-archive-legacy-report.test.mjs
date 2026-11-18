import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const row = (dir, state, extra = {}) => ({ dir, state, retirementCompleted: false, removedFiles: 0, removedLogicalBytes: 0, keptFiles: 0, keptBytes: 0, ...extra });
function report(t, { result, rawResult, stderr = "", status = 0 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-report-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resultFile = path.join(root, "r.json"), errFile = path.join(root, "e.log"), summary = path.join(root, "summary.md");
  fs.writeFileSync(resultFile, rawResult ?? (result === undefined ? "" : JSON.stringify(result) + "\n")); fs.writeFileSync(errFile, stderr);
  const run = spawnSync(process.execPath, ["scripts/growth-archive-legacy-report.mjs", resultFile, errFile, String(status)],
    { env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, encoding: "utf8" });
  return { ...run, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
}
const base = buckets => ({ schemaVersion: 1, mode: "legacy-retired-markers", completed: false, buckets, invalidMarkers: [], deferred: 0,
  removedLogicalBytes: buckets.reduce((n, b) => n + b.removedLogicalBytes, 0), keptFiles: 0, keptBytes: 0 });

test("先有硬失败、后遇锁竞争：必须非零退出，列出失败桶与原因，并保留已删除数量", t => {
  const r = report(t, { status: 3, result: { ...base([
    row("2026-09-01-00", "retired", { retirementCompleted: true, removedFiles: 2, removedLogicalBytes: 10 }),
    row("2026-09-02-00", "failed", { error: "source_changed", removedFiles: 1, removedLogicalBytes: 4 }),
    row("2026-09-03-00", "deferred-busy", { error: "growth_cleanup_busy" }),
  ]), stopped: "growth_cleanup_busy" } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /::error::旧桶 2026-09-02-00 未完成（failed）：source_changed；已删除 1 个文件/);
  assert.match(r.summary, /完成 1 桶，删除 3 个文件 14 字节/); assert.match(r.summary, /失败 1 桶/);
});
test("仅锁竞争：让行退出 0，已完成部分照实写入摘要", t => {
  const r = report(t, { status: 3, result: { ...base([
    row("2026-09-01-00", "retired", { retirementCompleted: true, removedFiles: 2, removedLogicalBytes: 10 }),
    row("2026-09-03-00", "deferred-busy", { error: "growth_cleanup_busy" }),
  ]), stopped: "growth_cleanup_busy" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /::warning::.*延后到下一班/); assert.match(r.summary, /完成 1 桶，删除 2 个文件 10 字节/);
  assert.doesNotMatch(r.stdout + r.summary, /未删除任何来源/);
  // 有完整回执但随后 SSH 断线（255）：不按让行处理。
  const cut = report(t, { status: 255, result: { ...base([row("2026-09-03-00", "deferred-busy", { error: "growth_cleanup_busy" })]), stopped: "growth_cleanup_busy" } });
  assert.equal(cut.status, 255, cut.stdout);
});
test("标记无效的桶：非零退出并点名；失败输出里夹带 busy 字样也不能放行", t => {
  const r = report(t, { status: 3, stderr: "growth_cleanup_busy\n", result: { ...base([row("2026-08-01-00", "marker-invalid", { error: "retirement_marker_unreadable" })]), invalidMarkers: ["2026-08-01-00", "2026-08-02-00"] } });
  assert.equal(r.status, 3); assert.match(r.stdout, /旧桶 2026-08-01-00 未完成（marker-invalid）/); assert.match(r.stdout, /旧桶 2026-08-02-00 的退役标记无效/);
});
test("全部完成退出 0；没有结构化结果时只有远端明确报锁竞争才让行，否则非零", t => {
  assert.equal(report(t, { status: 0, result: { ...base([row("2026-09-01-00", "retired", { retirementCompleted: true, removedFiles: 1, removedLogicalBytes: 3 })]), completed: true } }).status, 0);
  assert.equal(report(t, { status: 1, result: undefined, stderr: '{"error":"growth_cleanup_busy"}\n' }).status, 0);
  // [复审] 回执丢失 + busy 字样 + SSH 断线（退出 255）：不得放行，处理数量报未知。
  const reset = report(t, { status: 255, result: undefined, stderr: '{"error":"growth_cleanup_busy"}\nError: ssh: connection reset by peer\n' });
  assert.equal(reset.status, 255, reset.stdout); assert.match(reset.summary, /实际处理数量未知/); assert.doesNotMatch(reset.stdout, /尚未处理任何桶/);
  assert.equal(report(t, { status: 1, result: undefined, stderr: '{"error":"growth_cleanup_busy"}\nError: ssh: connection reset by peer\n' }).status, 1);
  assert.equal(report(t, { status: 124, result: undefined, stderr: '{"error":"growth_cleanup_busy"}\n' }).status, 124);
  assert.equal(report(t, { status: 1, result: undefined, stderr: 'growth_cleanup_busy\n' }).status, 1);
  assert.equal(report(t, { status: 1, result: undefined, stderr: '{"error":"growth_cleanup_busy","partial":{"removed":["a"]}}\n' }).status, 1);
  // 截断的结果（不是完整 JSON）同样不放行。
  const truncated = report(t, { status: 1, rawResult: '{"buckets":[{"state":"failed","removedFiles":1}', stderr: '{"error":"growth_cleanup_busy"}\n' });
  assert.equal(truncated.status, 1); assert.match(truncated.summary, /实际处理数量未知/);
  assert.equal(report(t, { status: 1, result: undefined, stderr: '{"error":"boom"}\n' }).status, 1);
  assert.equal(report(t, { status: 0, result: undefined }).status, 1);
  assert.equal(report(t, { status: 3, result: { ...base([]), completed: false } }).status, 3);
});
for (const file of ["growth-backup.yml", "growth-archive-offload.yml"]) test(`${file}: 旧桶清理步骤交给结构化报告脚本定成败，不再因出现 busy 字样直接退出 0`, () => {
  const block = fs.readFileSync(`.github/workflows/${file}`, "utf8").split("      - name: Retire remaining sources of Bilibili-retired archive buckets\n")[1].split("\n      - ")[0];
  assert.match(block, /node scripts\/growth-archive-legacy-report\.mjs "\$ROOT\/retirement-result-legacy\.json" "\$ROOT\/retirement-stderr-legacy\.log" "\$status"\n?$/);
  assert.doesNotMatch(block, /grep -q[^\n]*growth_cleanup_busy/);
});
