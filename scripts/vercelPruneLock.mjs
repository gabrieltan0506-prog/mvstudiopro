import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

export function acquirePruneLock(root, { machine, boot, pid, receipt, isAlive = (value) => {
  try { process.kill(value, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
} }) {
  const lock = `${root}/active.lock`;
  // 所有创建和恢复均先拿此短时独占锁；恢复者不能搬走另一进程的新锁。
  const guard = `${root}/recovery.lock`;
  mkdirSync(guard);
  try {
    try { mkdirSync(lock); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = JSON.parse(readFileSync(`${lock}/owner.json`, "utf8"));
      if (owner.machine !== machine || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.boot !== "string" || !owner.boot || typeof owner.receipt !== "string" || !owner.receipt) throw Error("清理锁身份未知");
      if (owner.boot === boot && isAlive(owner.pid)) throw Error("清理进程仍在运行");
      // 保留旧锁与回执；新轮次重新 GET 枚举，不重放旧 DELETE。
      renameSync(lock, `${root}/abandoned-lock-${randomUUID()}`);
      mkdirSync(lock);
    }
    writeFileSync(`${lock}/owner.json`, JSON.stringify({ machine, boot, pid, receipt }), { mode: 0o600, flush: true });
  } finally { rmSync(guard, { recursive: true }); }
  return () => {
    mkdirSync(guard);
    try {
      const owner = JSON.parse(readFileSync(`${lock}/owner.json`, "utf8"));
      if (owner.receipt !== receipt || owner.pid !== pid || owner.boot !== boot || owner.machine !== machine) throw Error("锁归属已变化，禁止释放");
      rmSync(lock, { recursive: true });
    } finally { rmSync(guard, { recursive: true }); }
  };
}
