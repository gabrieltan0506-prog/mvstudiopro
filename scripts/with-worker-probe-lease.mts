import { spawn } from "node:child_process";
import { acquireWorkerProbeLease } from "../server/services/workerProbeLease";

// 仅包裹本次授权的探针命令；持久化/上传也应放在该命令内再退出。
// 用法：tsx scripts/with-worker-probe-lease.mts node /app/isolated/probe.mjs poll
if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("探针租约命令仅允许在工作机执行");
const [command, ...args] = process.argv.slice(2);
if (!command) throw Error("缺少探针命令");
const lease = await acquireWorkerProbeLease();
let failure = false;
let killTimer: ReturnType<typeof setTimeout> | undefined;
const child = spawn(command, args, { stdio: "inherit", detached: true, env: { ...process.env, WORKER_PROBE_LEASE_ID: lease.id } });
const stop = () => {
  if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  if (!killTimer) killTimer = setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } }, 10_000);
};
const heartbeat = setInterval(() => { void lease.renew().catch(() => { failure = true; stop(); }); }, 20_000);
const interrupted = () => { failure = true; stop(); };
process.on("SIGINT", interrupted); process.on("SIGTERM", interrupted);
try {
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject); child.once("close", code => resolve(code ?? 1));
  });
  process.exitCode = failure ? 1 : code;
} finally {
  clearInterval(heartbeat); if (killTimer) clearTimeout(killTimer);
  process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", interrupted);
  await lease.release();
}
