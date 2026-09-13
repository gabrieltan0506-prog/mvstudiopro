import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquirePruneLock } from "./vercelPruneLock.mjs";

const identity = { machine: "test-machine", boot: "test-boot", pid: 101, receipt: "test-receipt-new" };
function fixture(t, previous) {
  const root = mkdtempSync(join(tmpdir(), "vercel-prune-lock-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lock = join(root, "active.lock");
  const ownerFile = join(lock, "owner.json");
  const writeOwner = owner => {
    mkdirSync(lock, { recursive: true });
    writeFileSync(ownerFile, JSON.stringify(owner));
  };
  if (previous) writeOwner(previous);
  return { root, lock, ownerFile, writeOwner,
    owner: () => JSON.parse(readFileSync(ownerFile, "utf8")) };
}

test("新锁持有实际身份，释放后可重新取得", t => {
  const f = fixture(t);
  const release = acquirePruneLock(f.root, identity);
  assert.equal(typeof release, "function");
  assert.deepEqual(f.owner(), identity);
  release();
  assert.equal(existsSync(f.lock), false);
  acquirePruneLock(f.root, { ...identity, receipt: "test-next" })();
});

test("同机同次启动的活进程锁拒绝抢占并保留原内容", t => {
  const previous = { ...identity, pid: 202, receipt: "test-live" };
  const f = fixture(t, previous);
  assert.throws(() => acquirePruneLock(f.root, { ...identity, isAlive: pid => {
    assert.equal(pid, 202); return true;
  } }));
  assert.deepEqual(f.owner(), previous);
});

test("死进程锁恢复保留旧 owner 和原回执文件", t => {
  const previous = { ...identity, pid: 202, receipt: "test-old.jsonl" };
  const f = fixture(t, previous);
  writeFileSync(join(f.root, previous.receipt), "test-original-audit\n");
  const release = acquirePruneLock(f.root, { ...identity, isAlive: () => false });
  assert.deepEqual(f.owner(), identity);
  const abandoned = readdirSync(f.root).filter(name => name.startsWith("abandoned-lock-"));
  assert.equal(abandoned.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, abandoned[0], "owner.json"), "utf8")), previous);
  assert.equal(readFileSync(join(f.root, previous.receipt), "utf8"), "test-original-audit\n");
  release();
});

test("同机旧 boot 的锁可恢复且无需探测旧 PID", t => {
  const f = fixture(t, { ...identity, boot: "test-old-boot", receipt: "test-old" });
  const release = acquirePruneLock(f.root, { ...identity, isAlive: () => assert.fail("旧 boot 不能依据当前 PID 判活") });
  assert.deepEqual(f.owner(), identity);
  release();
});

test("未知机器或缺失身份的锁均拒绝回收", t => {
  for (const previous of [
    { ...identity, machine: "test-other-machine" },
    { ...identity, boot: "" },
    { ...identity, pid: 0 },
    { ...identity, pid: 1.5 },
    { machine: identity.machine, pid: identity.pid },
  ]) {
    const f = fixture(t, previous);
    assert.throws(() => acquirePruneLock(f.root, { ...identity, isAlive: () => false }));
    assert.deepEqual(f.owner(), previous);
  }
});

test("缺失或损坏 owner 文件不能被自动恢复", t => {
  const f = fixture(t);
  mkdirSync(f.lock);
  assert.throws(() => acquirePruneLock(f.root, { ...identity, isAlive: () => false }));
  writeFileSync(f.ownerFile, "broken");
  assert.throws(() => acquirePruneLock(f.root, { ...identity, isAlive: () => false }));
  assert.equal(readFileSync(f.ownerFile, "utf8"), "broken");
});

test("已有恢复 guard 时拒绝第二个恢复者，不能移走当前锁", t => {
  const previous = { ...identity, pid: 202, receipt: "test-old" };
  const f = fixture(t, previous);
  mkdirSync(join(f.root, "recovery.lock"));
  assert.throws(() => acquirePruneLock(f.root, { ...identity, isAlive: () => false }));
  assert.deepEqual(f.owner(), previous);
  assert.equal(existsSync(join(f.root, "recovery.lock")), true);
});

test("恢复判活期间重入的第二个进程必须拒绝，首个恢复者独占新锁", t => {
  const f = fixture(t, { ...identity, pid: 202, receipt: "test-old" });
  let nested = 0;
  const release = acquirePruneLock(f.root, { ...identity, isAlive: () => {
    nested++;
    assert.throws(() => acquirePruneLock(f.root, {
      ...identity, pid: 303, receipt: "test-competing", isAlive: () => false,
    }));
    return false;
  } });
  assert.equal(nested, 1);
  assert.deepEqual(f.owner(), identity);
  assert.equal(existsSync(join(f.root, "recovery.lock")), false);
  release();
});

test("release 不得移除属于后来持有者的锁", t => {
  const f = fixture(t);
  const release = acquirePruneLock(f.root, identity);
  const other = { ...identity, pid: 404, receipt: "test-other-owner" };
  f.writeOwner(other);
  try { release(); } catch { /* 拒绝释放可以抛错，但不得删除他人锁。 */ }
  assert.deepEqual(f.owner(), other);
});
