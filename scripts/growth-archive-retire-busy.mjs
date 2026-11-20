// 只接受远端清理脚本退出 1 且尚未删除来源的锁竞争。SSH 断线、超时和矛盾回执保留失败。
import fs from "node:fs";

const [status, stdoutPath, stderrPath] = process.argv.slice(2);
function lines(path) {
  return fs.readFileSync(path, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
function isFlyBanner(line) {
  return /^Connecting to [a-fA-F0-9:.]+\.\.\.$/.test(line);
}
function isBusy() {
  if (status !== "1" || !lines(stdoutPath).every(isFlyBanner)) return false;
  const errors = lines(stderrPath).filter(line => !isFlyBanner(line) && line !== "Error: ssh shell: Process exited with status 1");
  if (errors.length !== 1) return false;
  let receipt;
  try { receipt = JSON.parse(errors[0]); } catch { return false; }
  if (receipt?.error !== "growth_cleanup_busy") return false;
  const {partial, buckets} = receipt;
  if (partial != null && !(partial.completed === false && Array.isArray(partial.removed)
      && partial.removed.length === 0 && partial.removedLogicalBytes === 0)) return false;
  return buckets === undefined || (Array.isArray(buckets) && buckets.every(bucket =>
    bucket?.removedFiles === 0 && bucket.removedLogicalBytes === 0 &&
    (bucket.state === "failed" || bucket.state === "no-eligible-sources")));
}
process.exitCode = isBusy() ? 0 : 1;
