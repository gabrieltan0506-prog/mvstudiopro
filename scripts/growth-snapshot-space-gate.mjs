// 建快照之前的空间闸门。硬链接本身不占空间，但 core 文件是实拷贝，且采集
// 用「写临时文件再改名」重写来源时，需要与最大单文件同样大的临时空间。
// 空间不够就不建快照，宁可本轮备份失败，也不能把采集所在的卷写满。
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SNAPSHOT_RESERVE_BYTES = 256 * 1024 * 1024;

export function resolveSnapshotReserveBytes(raw = process.env.GROWTH_SNAPSHOT_RESERVE_BYTES) {
  if (raw === undefined || raw === "") return DEFAULT_SNAPSHOT_RESERVE_BYTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error("growth_snapshot_reserve_invalid");
  return Math.floor(value);
}

/** copyBytes：会实拷贝的字节；largestLinkedBytes：被链接文件中最大的一个。 */
export function requiredSnapshotBytes({ copyBytes, largestLinkedBytes, reserveBytes }) {
  return copyBytes + Math.max(largestLinkedBytes, reserveBytes);
}

export function assertSnapshotSpace({ availableBytes, copyBytes, largestLinkedBytes, reserveBytes }) {
  const required = requiredSnapshotBytes({ copyBytes, largestLinkedBytes, reserveBytes });
  if (!(availableBytes >= required))
    throw new Error(`growth_snapshot_insufficient_space:available=${availableBytes}:required=${required}`);
  return { availableBytes, required };
}

async function fileBytes(file) {
  try { const st = await fs.lstat(file); return st.isFile() ? st.size : 0; }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
}

async function largestFileUnder(directory) {
  let largest = 0, entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return 0; throw error; }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) largest = Math.max(largest, await largestFileUnder(child));
    else if (entry.isFile()) largest = Math.max(largest, await fileBytes(child));
  }
  return largest;
}

/** 只读统计；缺文件按 0 计，由快照正文的既有校验去报缺失。 */
export async function measureSnapshotSources({ storeDir, copyFiles, linkedDirectories, linkedFiles }) {
  let copyBytes = 0, largestLinkedBytes = 0;
  for (const relative of copyFiles) copyBytes += await fileBytes(path.join(storeDir, relative));
  for (const relative of linkedDirectories)
    largestLinkedBytes = Math.max(largestLinkedBytes, await largestFileUnder(path.join(storeDir, relative)));
  for (const relative of linkedFiles)
    largestLinkedBytes = Math.max(largestLinkedBytes, await fileBytes(path.join(storeDir, relative)));
  return { copyBytes, largestLinkedBytes };
}

export async function assertSnapshotSpaceForStore({ storeDir, copyFiles, linkedDirectories, linkedFiles }) {
  const measured = await measureSnapshotSources({ storeDir, copyFiles, linkedDirectories, linkedFiles });
  const stat = await fs.statfs(storeDir);
  return assertSnapshotSpace({
    availableBytes: Number(stat.bavail) * Number(stat.bsize),
    ...measured,
    reserveBytes: resolveSnapshotReserveBytes(),
  });
}
