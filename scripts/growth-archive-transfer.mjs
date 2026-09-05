import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// 只包住当前传输的进程组；stdout 保留为原始归档字节，诊断全部走 stderr。
const args = process.argv.slice(2);
const limits = {
  "--idle-ms": 120_000,
  "--max-ms": 900_000,
  "--grace-ms": 5_000,
};
while (args.length && args[0] !== "--") {
  const key = args.shift();
  const value = Number(args.shift());
  if (
    !Object.hasOwn(limits, key) ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    console.error("归档传输保护参数无效");
    process.exit(64);
  }
  limits[key] = value;
}
if (args.shift() !== "--" || !args.length) {
  console.error("归档传输保护缺少命令");
  process.exit(64);
}
const started = performance.now();
let lastByteAt = started;
let bytes = 0;
let busy = false;
let stoppedCode;
let killTimer;
let closed = false;
const child = spawn(args[0], args.slice(1), {
  detached: true,
  stdio: ["inherit", "pipe", "pipe"],
});
function signalGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
function stop(code, reason) {
  if (stoppedCode !== undefined) return;
  stoppedCode = code;
  console.error(`[archive-transfer] ${reason}；已收 ${bytes} 字节`);
  signalGroup("SIGTERM");
  // 即使父进程先退出，也清除仍持有传输管道的同组子进程。
  killTimer = setTimeout(() => {
    signalGroup("SIGKILL");
    killTimer = undefined;
    if (closed) finish();
  }, limits["--grace-ms"]);
}
function finish(code = 1) {
  clearInterval(watchdog);
  clearInterval(heartbeat);
  process.exitCode = stoppedCode ?? (busy && code !== 0 ? 75 : code);
}
child.stdout.on("data", chunk => {
  bytes += chunk.length;
  lastByteAt = performance.now();
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
// flyctl 可能把远端退出码折成 1，因此只信远端明确输出的独立让行标记。
const lines = createInterface({ input: child.stderr });
lines.on("line", line => {
  if (line === "GROWTH_ARCHIVE_BUSY") busy = true;
});
process.stdout.on("error", () => stop(74, "输出端不可写，停止传输"));
process.on("SIGINT", () => stop(130, "收到取消信号"));
process.on("SIGTERM", () => stop(143, "收到取消信号"));
const watchdog = setInterval(
  () => {
    const now = performance.now();
    if (now - started >= limits["--max-ms"]) stop(124, "超过单次传输总时限");
    else if (now - lastByteAt >= limits["--idle-ms"])
      stop(124, "超过无数据进度时限");
  },
  Math.min(1000, limits["--idle-ms"], limits["--max-ms"])
);
const heartbeat = setInterval(() => {
  console.error(
    `[archive-transfer] 已收 ${bytes} 字节，耗时 ${Math.floor((performance.now() - started) / 1000)} 秒`
  );
}, 30_000);
child.on("error", () => {
  // 不回显命令参数或环境，避免把调用方的敏感信息带入日志。
  console.error("[archive-transfer] 无法启动传输程序");
});
child.on("close", (code, signal) => {
  closed = true;
  if (stoppedCode !== undefined && killTimer) return;
  finish(signal ? 1 : (code ?? 1));
});
