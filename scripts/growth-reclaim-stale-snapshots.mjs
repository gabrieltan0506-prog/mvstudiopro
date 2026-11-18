// 回收历史残留的「临时快照」目录。2026-11-18 事故：备份清理失败后残留的
// current-batches/<runId>-<attempt> 没有任何环节回收，来源被重写后快照变成实占，
// 把 /data 写满、采集全停。本脚本在每轮备份建新快照之前执行。
//
// - 由 GitHub Actions 经 stdin 传入 Fly 执行（node --input-type=module -），
//   不依赖 Fly 当前部署版本，也不 import 仓库内任何模块。
// - 不拿存储锁、不写任何新文件：盘已写满时也能执行，备份因此能自行恢复。
// - 只删 backups/current-batches 与 backups/archive-offload 下、标记合法、
//   owner 已退出且超龄的临时快照目录；绝不触碰采集原始数据与归档来源。
// - 快照里若有「只剩这一份」的付费原始回执或归档文件，整批保留并上报，
//   交站长决定（原始与解析 JSON 永久保存，未经批准不得清理）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const dryRun = args.includes("--dry-run");
const hours = (name, fallback) => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  // 空值 Number("") 为 0，会把「不限龄」误当成显式参数：一律拒绝。
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`growth_reclaim_${name}_invalid`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`growth_reclaim_${name}_invalid`);
  return value;
};
// 备份 job 上限 120 分钟，且与归档搬运同一并发组串行：超过 3 小时的 current 快照不可能仍在使用。
const currentHours = hours("current-hours", 3);
const archiveHours = hours("archive-hours", 24);
for (const arg of args)
  if (arg !== "--dry-run" && !/^--(?:current|archive)-hours=/.test(arg)) throw new Error("growth_reclaim_argument_invalid");

const root = path.resolve(process.env.GROWTH_STORE_DIR || "/data/growth");
const now = Date.now();
const uptimeSec = os.uptime();
const bootTimeMs = Number.isFinite(uptimeSec) && uptimeSec > 0 ? now - uptimeSec * 1000 : null;

function plainDirectory(directory) {
  const st = fs.lstatSync(directory);
  return st.isDirectory() && !st.isSymbolicLink() ? st : null;
}

function readMarker(directory) {
  const file = path.join(directory, ".snapshot-owner.json");
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("marker-type");
  return { st, owner: JSON.parse(fs.readFileSync(file, "utf8")) };
}

/** 只有能证明 owner 已不在才返回 true；EPERM 与一切未知状态都按存活处理。 */
function ownerExited(pid, markerMtimeMs) {
  if (bootTimeMs !== null && markerMtimeMs < bootTimeMs - 1000) return true; // 开机之前的进程不可能还活着。
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

/** 逐个 lstat 遍历，不跟随符号链接。 */
function* regularFiles(directory, relative = "") {
  for (const name of fs.readdirSync(directory).sort()) {
    const child = path.join(directory, name), childRelative = relative ? `${relative}/${name}` : name;
    const st = fs.lstatSync(child);
    if (st.isDirectory()) yield* regularFiles(child, childRelative);
    else if (st.isFile()) yield { relative: childRelative, st };
  }
}

/**
 * 受保护文件里「批外已无副本」的个数。不能只看链接数是否为 1：同一批内两个文件名可能指向
 * 同一 inode（链接数为 2，但两条链接都在待删目录里），删掉整批内容就没了。
 * 所以按 设备号:inode 统计整批目录内的链接数，链接总数不多于批内链接数即视为唯一一份。
 */
function soleCopies(directory, isProtected) {
  const inside = new Map(), files = [...regularFiles(directory)];
  for (const file of files) {
    const id = `${file.st.dev}:${file.st.ino}`;
    inside.set(id, (inside.get(id) || 0) + 1);
  }
  let count = 0;
  for (const file of files)
    if (isProtected(file.relative) && file.st.nlink <= inside.get(`${file.st.dev}:${file.st.ino}`)) count += 1;
  return count;
}

function treeBytes(directory) {
  let bytes = 0, soleBytes = 0;
  for (const file of regularFiles(directory)) { bytes += file.st.size; if (file.st.nlink === 1) soleBytes += file.st.size; }
  return { bytes, soleBytes };
}

const kinds = [
  {
    kind: "current",
    parent: path.join(root, "backups", "current-batches"),
    minAgeMs: currentHours * 3600_000,
    nameOk: name => /^\d+-\d+$/.test(name),
    inspect(directory, name) {
      const { st, owner } = readMarker(directory);
      if (owner.schemaVersion !== 1 || owner.batchId !== name || !Number.isSafeInteger(owner.pid) || owner.pid <= 1)
        return { keep: "marker-invalid" };
      if (now - st.mtimeMs < this.minAgeMs) return { keep: "too-new" };
      if (!ownerExited(owner.pid, st.mtimeMs)) return { keep: "owner-alive" };
      // 付费原始/解析回执写入后不再改写；链接数为 1 表示来源已不在，快照是唯一一份。
      // 两份共享账本会被原子重写，链接数为 1 属正常，不算唯一回执。
      const sole = soleCopies(directory,
        relative => relative.startsWith("directories/paid-research/") && !/\/(?:index|automation)\.json$/.test(relative));
      if (sole) return { keep: "sole-copy-receipt", soleCopies: sole };
      return { keep: null };
    },
  },
  {
    kind: "archive",
    parent: path.join(root, "backups", "archive-offload"),
    minAgeMs: archiveHours * 3600_000,
    nameOk: name => /^[0-9A-Za-z._-]+$/.test(name) && !name.startsWith("."),
    inspect(directory, name) {
      const { st, owner } = readMarker(directory);
      // 归档快照先在 <批号>.next 里写标记和硬链接，完成后才改名；机器中途重启会留下 .next 暂存目录。
      // 它的标记批号是不带 .next 的批号；同一并发组串行、job 上限 120 分钟，超龄即不可能仍在途。
      const batchId = name.endsWith(".next") ? name.slice(0, -5) : name;
      if (owner.schemaVersion !== 1 || owner.batchId !== batchId || owner.kind !== "archive-hardlink-snapshot")
        return { keep: "marker-invalid" };
      if (now - st.mtimeMs < this.minAgeMs) return { keep: "too-new" };
      // 顶层与 inventories/ 是快照自己写的清单（链接数恒为 1）；分桶子目录里全是归档来源的硬链接。
      // 链接数为 1 表示来源已被删除，无法在此证明冷备已核验：保留并上报。
      const sole = soleCopies(directory, relative => relative.includes("/") && !relative.startsWith("inventories/"));
      if (sole) return { keep: "sole-copy-archive", soleCopies: sole };
      return { keep: null };
    },
  },
];

const result = { ok: true, dryRun, removed: [], retained: [], errors: [] };
for (const spec of kinds) {
  let names;
  try {
    for (const directory of [root, path.join(root, "backups"), spec.parent])
      if (!plainDirectory(directory)) throw new Error("path-invalid");
    names = fs.readdirSync(spec.parent).sort();
  } catch (error) {
    if (error.code !== "ENOENT") result.errors.push({ kind: spec.kind, error: String(error.code || error.message) });
    continue;
  }
  for (const name of names) {
    const directory = path.join(spec.parent, name);
    let before;
    try { before = fs.lstatSync(directory); } catch { continue; }
    if (!before.isDirectory() || before.isSymbolicLink()) continue; // 游标等普通文件与符号链接一律不碰。
    if (!spec.nameOk(name)) { result.retained.push({ kind: spec.kind, batch: name, reason: "name-invalid" }); continue; }
    try {
      const verdict = spec.inspect(directory, name);
      if (verdict.keep) { result.retained.push({ kind: spec.kind, batch: name, reason: verdict.keep, ...(verdict.soleCopies ? { soleCopies: verdict.soleCopies } : {}) }); continue; }
      const { bytes, soleBytes } = treeBytes(directory);
      if (!dryRun) {
        const current = fs.lstatSync(directory);
        if (current.ino !== before.ino || current.dev !== before.dev || !current.isDirectory()) throw new Error("changed");
        // 只删这一个已确认的临时目录；rm 只是解除硬链接，来源 inode 保留。
        fs.rmSync(directory, { recursive: true, force: false });
      }
      // soleBytes：只剩快照引用的字节，即删除后实际释放的空间上限。
      result.removed.push({ kind: spec.kind, batch: name, bytes, reclaimableBytes: soleBytes });
    } catch (error) {
      result.retained.push({ kind: spec.kind, batch: name, reason: `error:${String(error.code || error.message)}` });
    }
  }
}
// 日志只含批次名与字节数，不含任何正文。
console.log(JSON.stringify(result));
