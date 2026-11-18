import fs from "node:fs/promises";
import path from "node:path";

// 开机回收 Growth 存储目录内「写临时文件再改名」写者遗留的临时文件（写盘失败/进程被杀时残留，单个可达数百 MB）。
// 只删：文件名精确命中下列写者临时名、lstat 为普通文件、mtime 超过 1 小时；
// 绝不进入 backups/、archive/（其中 `<batch>.next` 目录与证据归其他代码所有），不跟随符号链接，不碰非临时数据文件。
// 不写任何新文件（满盘时可安全运行），只打印相对路径与字节数，任何异常都吞掉，不阻断启动。
//
// 不取存储变更锁：每个写者都是 writeFile/流式写完立即 rename，写入期间每次落盘都会刷新 mtime，
// 活写者的临时文件 mtime 必然接近当前时间；变更锁心跳 ≤30 秒、15 分钟无心跳即视为过期，
// 因此 mtime 超过 1 小时的临时文件不可能属于仍在运行的写者。即便极端停滞写者的临时文件被删，
// 其 rename 只会以 ENOENT 失败，目标文件从不被本清扫触碰。
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const GROWTH_STORE_TEMP_NAME_PATTERNS: readonly RegExp[] = [
  // trendStore writeJsonAtomic / writeBufferAtomic、growthJsonStream writeGrowthGzipJson：<目标>.<pid>.<毫秒>.<base36随机>.next
  /^.+\.\d+\.\d{13}\.[0-9a-z]+\.next$/,
  // trendAdaptiveConfig（<pid>.<序号>）、douyinCredentialHealth / platformCollectionLane（<pid>.<毫秒>）：<目标>.<pid>.<数字>.next
  /^.+\.\d+\.\d+\.next$/,
  // trendShortlistIndex：<目标>.<pid>.<uuid>.next
  new RegExp(`^.+\\.\\d+\\.${UUID}\\.next$`),
  // weixinChannelsMinerStore：<目标>.<pid>.<毫秒>.tmp
  /^.+\.\d+\.\d{13}\.tmp$/,
];
// paid-research 下是付费原始/解析回执：其临时文件可能是唯一一份已付费响应，不自动清理（体积也很小）。
const PROTECTED_DIR_NAMES = new Set(["backups", "archive", "paid-research"]);
const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;
const MAX_DEPTH = 8;

export function isGrowthStoreTempFileName(name: string) {
  return GROWTH_STORE_TEMP_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function resolveGrowthStoreDir() {
  return path.resolve(process.env.GROWTH_STORE_DIR || path.join(path.resolve(process.cwd(), ".cache"), "growth"));
}

export async function sweepGrowthStoreStaleTempFiles(options?: { root?: string; nowMs?: number; minAgeMs?: number }) {
  const result = { removed: 0, bytes: 0 };
  try {
    const root = path.resolve(options?.root || resolveGrowthStoreDir());
    const nowMs = options?.nowMs ?? Date.now();
    const minAgeMs = options?.minAgeMs ?? DEFAULT_MIN_AGE_MS;
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop()!;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            if (!PROTECTED_DIR_NAMES.has(entry.name) && depth < MAX_DEPTH) stack.push({ dir: full, depth: depth + 1 });
            continue;
          }
          if (!isGrowthStoreTempFileName(entry.name)) continue;
          const stat = await fs.lstat(full);
          if (!stat.isFile() || nowMs - stat.mtimeMs <= minAgeMs) continue;
          await fs.unlink(full);
          result.removed += 1;
          result.bytes += stat.size;
          console.info(`[growth.store] 回收遗留临时文件 ${path.relative(root, full)} bytes=${stat.size}`);
        } catch {}
      }
    }
    if (result.removed) console.info(`[growth.store] 遗留临时文件回收 ${result.removed} 个 bytes=${result.bytes}`);
  } catch {}
  return result;
}
