// 读取 growth-reclaim-stale-snapshots.mjs 经 SSH 返回的输出，转成 Actions 日志与 Summary。
// flyctl 可能在 JSON 前后夹带提示行：只取最后一行合法 JSON；取不到即失败，由调用方降级为 warning。
import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: growth-reclaim-report.mjs FILE");
let result = null;
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).reverse()) {
  try {
    const parsed = JSON.parse(line);
    if (parsed && parsed.ok === true && Array.isArray(parsed.removed) && Array.isArray(parsed.retained)) { result = parsed; break; }
  } catch { /* 非 JSON 行 */ }
}
if (!result) { console.error("growth_reclaim_report_unparsable"); process.exit(1); }
const safe = value => String(value).replace(/[^0-9A-Za-z._:-]/g, "?").slice(0, 80);
const mb = bytes => (Number(bytes || 0) / 1048576).toFixed(1);
const lines = [];
for (const item of result.removed)
  lines.push(`已回收历史临时快照 ${safe(item.kind)}/${safe(item.batch)}：释放上限 ${mb(item.reclaimableBytes)}MB（目录合计 ${mb(item.bytes)}MB）`);
// 「只剩快照这一份」的批次不会自动删除，需站长确认，单独醒目标出。
const sole = result.retained.filter(item => String(item.reason).startsWith("sole-copy"));
for (const item of sole)
  console.log(`::warning::临时快照 ${safe(item.kind)}/${safe(item.batch)} 含 ${Number(item.soleCopies) || 0} 个只剩这一份的文件，已保留，需站长确认后处理`);
const others = result.retained.filter(item => !String(item.reason).startsWith("sole-copy") && item.reason !== "too-new");
for (const item of others) lines.push(`保留 ${safe(item.kind)}/${safe(item.batch)}：${safe(item.reason)}`);
for (const item of result.errors || []) console.log(`::warning::历史临时快照回收检查异常 ${safe(item.kind)}：${safe(item.error)}`);
for (const item of result.errors || []) lines.push(`回收检查异常 ${safe(item.kind)}：${safe(item.error)}`);
for (const line of lines) console.log(line);
if (!lines.length && !sole.length) console.log("没有需要回收的历史临时快照");
if (process.env.GITHUB_STEP_SUMMARY && (result.removed.length || sole.length))
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    [...lines, ...sole.map(item => `需确认：${safe(item.kind)}/${safe(item.batch)} 含只剩一份的文件，已保留`)].join("\n") + "\n");
