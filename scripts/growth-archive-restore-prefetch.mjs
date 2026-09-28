import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchGrowthColdStoreAsset } from "/app/shared/growthColdStoreRelease.mjs";

// 在 Fly 内预取较大的归档；正式恢复 CLI 随后仍须验证 manifest、SHA、解包和 JSON。
const [dir, expectedBytesText, expectedSha] = process.argv.slice(2);
if (
  !/^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(dir || "")
  || !/^\d+$/.test(expectedBytesText || "")
  || !Number.isSafeInteger(Number(expectedBytesText))
  || Number(expectedBytesText) <= 0
  || !/^[0-9a-f]{64}$/.test(expectedSha || "")
) throw new Error("归档预取参数非法");

const asset = `archive-${dir}.tar.gz`;
const base = String(process.env.GROWTH_GITHUB_COLD_STORE_BASE_URL || "").trim();
if (!base) throw new Error("归档冷备入口不可用");
const root = `/tmp/growth-cold-verify-${dir}/bundles`;
await fsp.mkdir(root, { recursive: true });
const target = path.join(root, asset);
const temporary = `${target}.next-${process.pid}`;
try {
  const response = await fetchGrowthColdStoreAsset(base, asset, {
    signal: AbortSignal.timeout(180_000),
  });
  if (!response?.ok || !response.body) {
    throw new Error(`归档预取失败：HTTP ${response?.status ?? "无响应"}`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(temporary, { flags: "wx" }),
  );
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(temporary)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  if (bytes !== Number(expectedBytesText) || hash.digest("hex") !== expectedSha) {
    throw new Error("归档预取摘要不符，保留 Fly 原件");
  }
  await fsp.rename(temporary, target);
  console.log(JSON.stringify({ ok: true, dir, bytes }));
} finally {
  await fsp.rm(temporary, { force: true });
}
