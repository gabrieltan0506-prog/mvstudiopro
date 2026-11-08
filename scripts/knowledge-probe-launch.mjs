// 在工作机内启动隔离探针：沿用机器自身运行环境（凭证只在 Fly 机内存，不打印、不外传），
// 以租约包装器后台运行，SSH 断开后继续；只输出启动回执。
import { readFileSync, openSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
const [dir, mode = "run"] = process.argv.slice(2);
if (!dir || !existsSync(`${dir}/entry.mjs`) || !existsSync(`${dir}/config.json`)) throw Error("探针目录不完整");
if (!["prepare", "run"].includes(mode)) throw Error("模式无效");
const env = { ...process.env };
for (const line of readFileSync("/proc/1/environ", "utf8").split("\0")) {
  const i = line.indexOf("=");
  if (i > 0 && !(line.slice(0, i) in env)) env[line.slice(0, i)] = line.slice(i + 1);
}
if (env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在工作机启动");
const out = openSync(`${dir}/run.log`, "a");
const child = spawn(process.execPath, [`${dir}/lease.mjs`, process.execPath, `${dir}/entry.mjs`, `${dir}/config.json`, mode], { cwd: "/app", env, detached: true, stdio: ["ignore", out, out] });
child.unref();
console.log(JSON.stringify({ launched: true, mode, pid: child.pid }));
