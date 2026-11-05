import fs from "node:fs/promises";
import path from "node:path";
import { withGrowthStoreMutationLock } from "../server/growth/growthStoreMutationLock";

const flag = process.argv.slice(2).find(arg => arg.startsWith("--batch-id="));
const batchId = flag?.slice("--batch-id=".length) || "";
if (!/^\d+-\d+$/.test(batchId) || process.argv.slice(2).length !== 1)
  throw new Error("growth_snapshot_cleanup_batch_invalid");
if (!process.env.GROWTH_STORE_DIR) throw new Error("growth_snapshot_cleanup_store_required");
const root = path.resolve(process.env.GROWTH_STORE_DIR);
const target = path.join(root, "backups", "current-batches", batchId);
const marker = path.join(target, ".snapshot-owner.json");

async function inspectOwner() {
  for (const directory of [root, path.join(root, "backups"), path.join(root, "backups/current-batches"), target]) {
    const st = await fs.lstat(directory);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("growth_snapshot_cleanup_path_invalid");
  }
  const markerStat = await fs.lstat(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error("growth_snapshot_cleanup_marker_invalid");
  const raw = await fs.readFile(marker, "utf8");
  const owner = JSON.parse(raw);
  if (owner.schemaVersion !== 1 || owner.batchId !== batchId || !Number.isSafeInteger(owner.pid) || owner.pid <= 1)
    throw new Error("growth_snapshot_cleanup_owner_invalid");
  try {
    process.kill(owner.pid, 0);
    throw new Error("growth_snapshot_cleanup_owner_alive");
  } catch (error) {
    // Only ESRCH establishes that the owner exited. EPERM and all unknown states retain it.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  return { markerStat, raw, targetStat: await fs.lstat(target) };
}

async function main() {
  try { await fs.lstat(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(JSON.stringify({ ok: true, batchId, removed: false, reason: "batch-not-present" })); return;
    }
    throw error;
  }
  // Reject a live owner immediately instead of waiting on its mutation lease.
  const before = await inspectOwner();
  await withGrowthStoreMutationLock("cleanup-current-snapshot", async lease => {
    const current = await inspectOwner();
    if (current.targetStat.ino !== before.targetStat.ino || current.targetStat.dev !== before.targetStat.dev
        || current.markerStat.ino !== before.markerStat.ino || current.markerStat.dev !== before.markerStat.dev
        || current.raw !== before.raw) throw new Error("growth_snapshot_cleanup_owner_changed");
    await lease.assertOwned();
    // Only this exact owned temporary tree. rm unlinks hardlinks; source inodes remain.
    await fs.rm(target, { recursive: true, force: false });
  }, { waitTimeoutMs: 5_000 });
  console.log(JSON.stringify({ ok: true, batchId, removed: true, sourceDeletionAuthorized: false }));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
