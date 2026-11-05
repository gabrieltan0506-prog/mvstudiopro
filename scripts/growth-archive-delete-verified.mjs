#!/usr/bin/env node
// 仅已授权的B站策略可调用精确回执约束的来源退役，禁止整桶或其他平台删除。
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const hash = data => createHash("sha256").update(data).digest("hex");
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const bucketPattern = /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/;
const filePattern = /^archive\/(\d{4}-\d{2}-\d{2}(?:-\d{2})?)\/bilibili-[A-Za-z0-9_.+-]+\.json\.gz$/;
const fail = reason => { throw new Error(`growth_cleanup_${reason}`); };
export const cleanupReceiptSha256 = receipt => hash(JSON.stringify(receipt));

function validateReceipt(receipt, now) {
  if (receipt?.schemaVersion !== 1 || receipt.evidenceKind !== "remote-restore"
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(receipt.repository || "")
      || !Array.isArray(receipt.files) || !receipt.files.length
      || !Array.isArray(receipt.backup?.assets) || !receipt.backup.assets.length
      || !Array.isArray(receipt.backup?.restores) || !receipt.backup.restores.length)
    fail("receipt_invalid");
  const timestamp = Date.parse(receipt.createdAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000 || now - timestamp > 24 * 60 * 60_000)
    fail("receipt_expired_or_future");
  const seen = new Set();
  for (const row of receipt.files) {
    if (!filePattern.test(row.path || "") || seen.has(row.path)
        || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || !validHash(row.sha256))
      fail("file_scope_invalid");
    seen.add(row.path);
  }
}

async function directory(file) {
  const st = await fs.lstat(file);
  if (!st.isDirectory() || st.isSymbolicLink()) fail("directory_type_invalid");
  return st;
}
async function sourceFile(root, row) {
  const bucket = filePattern.exec(row.path)[1];
  await directory(root);
  await directory(path.join(root, "archive"));
  await directory(path.join(root, "archive", bucket));
  const filename = path.join(root, row.path);
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) fail("source_not_regular");
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const held = await handle.stat();
    if (before.ino !== held.ino || before.dev !== held.dev) fail("source_changed");
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length; digest.update(chunk);
    }
    const actualHash = digest.digest("hex");
    const after = await fs.lstat(filename);
    const final = await handle.stat();
    if (!sameIdentity(before, after) || !sameIdentity(before, final)
        || bytes !== row.bytes || actualHash !== row.sha256) fail("source_changed");
    return { ...row, ino: after.ino, dev: after.dev, nlink: after.nlink,
      mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs,
      allocatedBytes: Number.isSafeInteger(after.blocks) ? after.blocks * 512 : null };
  } finally { await handle.close(); }
}
function sameIdentity(a, b) {
  return b.isFile() && a.ino === b.ino && a.dev === b.dev && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
}
function sameInspection(a, b) {
  return a.ino === b.ino && a.dev === b.dev && a.bytes === b.bytes
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
}
async function protectedBuckets(root) {
  return (await fs.readdir(path.join(root, "archive"))).filter(name => bucketPattern.test(name)).sort().slice(-2);
}
async function inspect(root, receipt) {
  const protectedNames = await protectedBuckets(root);
  const files = [];
  for (const row of receipt.files) {
    if (protectedNames.includes(filePattern.exec(row.path)[1])) fail("latest_bucket_protected");
    files.push(await sourceFile(root, row));
  }
  return files;
}

// 部分平台退役后冻结整桶发布，避免剩余子集覆盖仍被冷读引用的完整备份。
async function preserveRetirementMarkers(root, receipt, receiptSha256) {
  const parent=path.join(root,'.growth-archive-retired');
  await fs.mkdir(parent,{recursive:true}); await directory(parent);
  for(const dir of new Set(receipt.files.map(row=>filePattern.exec(row.path)[1]))) {
    const restore=receipt.backup.restores.find(row=>row.dir===dir);
    if(!restore)fail('retirement_restore_missing');
    const marker=path.join(parent,`${dir}.json`);
    const value={schemaVersion:1,dir,platform:'bilibili',receiptSha256,restore,createdAt:new Date().toISOString()};
    let handle;
    try { handle=await fs.open(marker,'wx',0o600); }
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const st=await fs.lstat(marker);
      if(!st.isFile() || st.isSymbolicLink())fail('retirement_marker_invalid');
      const existing=JSON.parse(await fs.readFile(marker,'utf8'));
      if(existing.schemaVersion!==1 || existing.dir!==dir || existing.platform!=='bilibili'
          || existing.receiptSha256!==receiptSha256)fail('retirement_marker_conflict');
      continue;
    }
    try { await handle.writeFile(JSON.stringify(value,null,2)); await handle.sync(); }
    finally { await handle.close(); }
  }
  const handle=await fs.open(parent,'r');try{await handle.sync();}finally{await handle.close();}
}

async function acquireLeases(root) {
  const token = `growth-cleanup:${process.pid}:${randomUUID()}`;
  const leases = [];
  let timer, pending = null, lost = null;
  async function assertOwned() {
    if (lost) throw lost;
    for (const lease of leases) {
      const [current, held, raw] = await Promise.all([
        fs.lstat(lease.file), lease.handle.stat(), fs.readFile(lease.file, "utf8"),
      ]);
      if (!current.isFile() || current.ino !== held.ino || current.dev !== held.dev || raw !== lease.raw)
        fail("lease_lost");
    }
  }
  async function release() {
    clearInterval(timer);
    if (pending) await pending;
    for (const lease of [...leases].reverse()) {
      try {
        const [current, held, raw] = await Promise.all([
          fs.lstat(lease.file), lease.handle.stat(), fs.readFile(lease.file, "utf8"),
        ]);
        if (current.isFile() && current.ino === held.ino && current.dev === held.dev && raw === lease.raw)
          await fs.unlink(lease.file);
      } catch { /* Never remove another owner's replacement lease. */ }
      await lease.handle.close();
    }
  }
  try {
    for (const [name, raw] of [
      [".growth-platform-collection.lock", token],
      [".growth-store-mutation.lock", JSON.stringify({ token, pid: process.pid, operation: "verified-archive-cleanup" })],
    ]) {
      const file = path.join(root, name);
      let handle;
      try { handle = await fs.open(file, "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") fail("busy"); throw error; }
      leases.push({ file, handle, raw });
      await handle.writeFile(raw);
      await handle.sync();
    }
    await assertOwned();
    timer = setInterval(() => {
      if (pending || lost) return;
      pending = (async () => {
        await assertOwned();
        for (const lease of leases) { const now = new Date(); await lease.handle.utimes(now, now); }
      })().catch(error => { lost = error; }).finally(() => { pending = null; });
    }, 10_000);
    timer.unref();
    return { assertOwned, release };
  } catch (error) { await release(); throw error; }
}

/**
 * `verifyEvidence` must re-query remote backup metadata and bind its result to this
 * exact receipt and file list. A receipt is operator evidence, not a signature.
 * Dry-run never creates locks/journals or mutates source. Apply takes both leases,
 * preflights every file, then rechecks each file immediately before unlink.
 */
export async function deleteVerifiedArchive({ root: rootArg, receipt, receiptSha256,
  approveSha256, apply = false, verifyEvidence, journalPath, now = Date.now(), signal, onJournal }) {
  validateReceipt(receipt, now);
  const digest = cleanupReceiptSha256(receipt);
  if (receiptSha256 !== undefined && receiptSha256 !== digest) fail("receipt_digest_mismatch");
  const root = path.resolve(rootArg);
  await directory(root);
  if (apply && (!validHash(approveSha256) || approveSha256 !== digest)) fail("explicit_approval_required");
  let evidenceVerified = false;
  if (verifyEvidence) {
    const proof = await verifyEvidence(receipt);
    if (proof?.verified !== true || proof.receiptSha256 !== digest
        || JSON.stringify(proof.files) !== JSON.stringify(receipt.files)) fail("evidence_binding_invalid");
    evidenceVerified = true;
  }
  if (apply && !evidenceVerified) fail("remote_evidence_verifier_required");
  const result = { schemaVersion: 1, mode: apply ? "apply" : "dry-run", receiptSha256: digest,
    evidenceVerified, files: [], candidates: receipt.files.length, removed: [], removedLogicalBytes: 0,
    unlinkedLastLinkAllocatedBytes: 0, retainedByOtherLinksBytes: 0,
    actualFilesystemFreeBytesVerified: false, completed: false };
  let lease, journal;
  const record = async entry => {
    await journal.writeFile(`${JSON.stringify({ at: new Date().toISOString(), receiptSha256: digest, ...entry })}\n`);
    await journal.sync();
    // 本地审计观察点；必须等待，便于可靠验证中断和锁所有权变化。
    await onJournal?.(entry);
  };
  try {
    signal?.throwIfAborted();
    if (apply) {
      if (!journalPath) fail("journal_required");
      const journalAbsolute = path.resolve(journalPath);
      const canonicalRoot = await fs.realpath(root);
      const canonicalParent = await fs.realpath(path.dirname(journalAbsolute));
      if (canonicalParent === canonicalRoot || canonicalParent.startsWith(`${canonicalRoot}${path.sep}`))
        fail("journal_must_be_outside_store");
      lease = await acquireLeases(root);
      journal = await fs.open(journalAbsolute, "wx", 0o600);
      await record({ event: "start", files: receipt.files });
    }
    result.files = await inspect(root, receipt);
    result.logicalBytes = result.files.reduce((total, row) => total + row.bytes, 0);
    result.estimatedReclaimableAllocatedBytes = result.files.reduce((total, row) =>
      total + (row.nlink === 1 ? row.allocatedBytes || 0 : 0), 0);
    result.allocatedBytesKnown = result.files.every(row => row.allocatedBytes !== null);
    if (!apply) { result.completed = true; return result; }
    await preserveRetirementMarkers(root,receipt,digest);
    await record({ event: "preflight", files: result.files });
    for (const expected of result.files) {
      signal?.throwIfAborted();
      await lease.assertOwned();
      if ((await protectedBuckets(root)).includes(filePattern.exec(expected.path)[1])) fail("latest_bucket_protected");
      const current = await sourceFile(root, expected);
      if (!sameInspection(expected, current)) fail("source_changed_after_preflight");
      await record({ event: "unlink-intent", file: expected.path });
      await lease.assertOwned();
      // Recheck all source ancestors and the final inode after the durable intent.
      await directory(root);
      await directory(path.join(root, "archive"));
      await directory(path.dirname(path.join(root, expected.path)));
      const final = await fs.lstat(path.join(root, expected.path));
      if (!final.isFile() || final.ino !== current.ino || final.dev !== current.dev
          || final.size !== current.bytes || final.mtimeMs !== current.mtimeMs
          || final.ctimeMs !== current.ctimeMs || final.nlink !== current.nlink) fail("source_changed_before_unlink");
      signal?.throwIfAborted();
      await fs.unlink(path.join(root, expected.path));
      result.removed.push(expected.path);
      result.removedLogicalBytes += expected.bytes;
      if (current.nlink === 1) result.unlinkedLastLinkAllocatedBytes += current.allocatedBytes || 0;
      else result.retainedByOtherLinksBytes += current.allocatedBytes || 0;
      const parent = await fs.open(path.dirname(path.join(root, expected.path)), "r");
      try { await parent.sync(); } finally { await parent.close(); }
      await record({ event: "unlinked", file: expected.path, logicalBytes: expected.bytes,
        lastLink: current.nlink === 1, allocatedBytes: current.allocatedBytes });
    }
    result.completed = true;
    await record({ event: "completed", result });
    return result;
  } catch (error) {
    if (journal) await record({ event: "stopped", error: error.message, result }).catch(() => {});
    error.cleanupResult = result;
    throw error;
  } finally {
    await journal?.close();
    await lease?.release();
  }
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") options.apply = true;
    else if (["--root", "--receipt", "--approve-sha256", "--journal"].includes(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) fail("argument_missing");
      options[args[i].slice(2)] = args[++i];
    } else fail("argument_invalid");
  }
  if (!options.root || !options.receipt) fail("usage_root_and_receipt_required");
  const receipt = JSON.parse(await fs.readFile(options.receipt, "utf8"));
  const controller = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => controller.abort(new Error(`cleanup_cancelled:${name}`)));
  let verifyEvidence;
  if (options.apply) ({ verifyCleanupEvidenceOnFly: verifyEvidence } = await import("./growth-archive-cleanup.mjs"));
  const result = await deleteVerifiedArchive({ root: options.root, receipt, apply: options.apply,
    approveSha256: options["approve-sha256"], journalPath: options.journal,
    verifyEvidence, signal: controller.signal });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({ error: error.message, result: error.cleanupResult }));
    process.exitCode = 1;
  });
}
