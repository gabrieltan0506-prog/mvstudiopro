// 读取「旧范围已退役桶剩余来源清理」的结构化结果，决定本步骤成败。
// 规则：只有锁竞争/取消造成的延后才允许让行（退出 0）；只要有 failed 或标记无效的桶，
// 就逐桶列出桶名与原因、保留已删除数量，并返回非零——不能因为输出里出现过
// growth_cleanup_busy 就把真实失败报成成功。
// 用法：node growth-archive-legacy-report.mjs RESULT_JSON STDERR_LOG REMOTE_STATUS
import fs from "node:fs";

const [resultFile, stderrFile, statusArg] = process.argv.slice(2);
const remoteStatus = Number(statusArg);
const readText = file => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const safe = value => String(value ?? "").replace(/[^0-9A-Za-z._:,=\- ]/g, "?").slice(0, 160);
const stderrText = readText(stderrFile);
let result = null;
for (const line of readText(resultFile).split(/\r?\n/).reverse()) {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.buckets)) { result = parsed; break; }
  } catch { /* 非 JSON 行 */ }
}
const say = line => {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
};
if (!result) {
  // 没有结构化结果：只有远端明确报锁竞争、且没有任何其他可判定信息时才让行。
  if (/growth_cleanup_busy/.test(stderrText) && !/"buckets"/.test(stderrText)) {
    console.log("::warning::旧桶剩余来源清理遇到服务端采集锁，尚未处理任何桶，延后到下一班");
    process.exit(0);
  }
  console.log("::error::旧桶剩余来源清理没有返回可解析的结果");
  process.exit(Number.isInteger(remoteStatus) && remoteStatus !== 0 ? remoteStatus : 1);
}
const buckets = result.buckets.filter(row => row && typeof row === "object");
const failed = buckets.filter(row => row.state === "failed" || row.state === "marker-invalid");
const invalid = (Array.isArray(result.invalidMarkers) ? result.invalidMarkers : [])
  .filter(dir => !failed.some(row => row.dir === dir));
const busy = buckets.filter(row => row.state === "deferred-busy");
const done = buckets.filter(row => row.retirementCompleted === true).length;
const removedFiles = buckets.reduce((sum, row) => sum + (Number(row.removedFiles) || 0), 0);
const kept = buckets.filter(row => Number(row.keptFiles) > 0);
say(`旧桶剩余来源：完成 ${done} 桶，删除 ${removedFiles} 个文件 ${Number(result.removedLogicalBytes) || 0} 字节；`
  + `保留未核验 ${Number(result.keptFiles) || 0} 个文件 ${Number(result.keptBytes) || 0} 字节（${kept.map(row => safe(row.dir)).join(",") || "无"}）；`
  + `延后 ${(Number(result.deferred) || 0) + busy.length} 桶；失败 ${failed.length + invalid.length} 桶。`);
for (const row of failed)
  console.log(`::error::旧桶 ${safe(row.dir)} 未完成（${safe(row.state)}）：${safe(row.error) || "原因未记录"}；已删除 ${Number(row.removedFiles) || 0} 个文件`);
for (const dir of invalid) console.log(`::error::旧桶 ${safe(dir)} 的退役标记无效，来源已保留，该桶未完成`);
if (failed.length || invalid.length) process.exit(Number.isInteger(remoteStatus) && remoteStatus !== 0 ? remoteStatus : 3);
if (busy.length || /growth_cleanup_busy|cancelled/.test(String(result.stopped || ""))) {
  console.log("::warning::旧桶剩余来源清理遇到服务端采集锁或被取消，未完成的桶延后到下一班");
  process.exit(0);
}
if (result.completed === false || (Number.isInteger(remoteStatus) && remoteStatus !== 0)) {
  console.log("::error::旧桶剩余来源清理未完成，但结果中没有标出失败的桶");
  process.exit(Number.isInteger(remoteStatus) && remoteStatus !== 0 ? remoteStatus : 3);
}
