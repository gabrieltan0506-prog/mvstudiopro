/**
 * 將環境底圖從 Unsplash 拉到 client/public/ambient/，與 client/src/lib/ambientSceneBackgrounds.ts 使用同一批 photoId。
 *
 * 用法：
 *   pnpm run ambient:fetch-images              缺檔或小於 1KB 時才下載
 *   pnpm run ambient:fetch-images:refresh      強制全部重下
 *   pnpm run ambient:fetch-images:daily          超過 24h 的檔案重下（適合 cron 每日跑一次）
 *
 * 注意：Unsplash 下架的 photo 會 404，需換 ID 後更新此表與 TS。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "client", "public", "ambient");

const argv = process.argv.slice(2);
const refreshAll = argv.includes("--refresh");
let maxAgeMs = 0;
const maxAgeArg = argv.find((a) => a.startsWith("--max-age-hours="));
if (maxAgeArg) {
  const h = parseFloat(maxAgeArg.split("=")[1] || "0");
  if (Number.isFinite(h) && h > 0) maxAgeMs = h * 3600 * 1000;
}

/** 與 ambientSceneBackgrounds 中去重後一致；改輪播表時請同步 */
const PHOTO_IDS = [
  "photo-1433086966358-54859d0ed716",
  "photo-1464822759023-fed622ff2c3b",
  "photo-1469474968028-56623f02e42e",
  "photo-1470071459604-3b5ec3a7fe05",
  "photo-1472214103451-9374bd1c798e",
  "photo-1483921020237-2ff51e8e4b22",
  "photo-1500382017468-9049fed747ef",
  "photo-1501594907352-04cda38ebc29",
  "photo-1506905925346-21bda4d32df4",
  "photo-1507525428034-b723cf961d3e",
  "photo-1519681393784-d120267933ba",
  "photo-1527482797697-8795b05a13fe",
];

function unsplashUrl(photoId) {
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1920&q=82`;
}

function shouldFetch(dest) {
  if (refreshAll) return true;
  if (!fs.existsSync(dest)) return true;
  const st = fs.statSync(dest);
  if (st.size < 1024) return true;
  if (maxAgeMs > 0 && Date.now() - st.mtimeMs > maxAgeMs) return true;
  return false;
}

async function downloadOne(photoId) {
  const dest = path.join(OUT_DIR, `${photoId}.jpg`);
  if (!shouldFetch(dest)) {
    console.log(`skip ${photoId}.jpg`);
    return;
  }
  const url = unsplashUrl(photoId);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`${photoId}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(dest, buf);
  console.log(`ok ${photoId}.jpg (${Math.round(buf.length / 1024)} KB)`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const id of PHOTO_IDS) {
  try {
    await downloadOne(id);
  } catch (e) {
    console.error(String(e?.message || e));
    failed++;
  }
}

if (failed) {
  process.exitCode = 1;
  console.error(`完成：${PHOTO_IDS.length - failed} 成功，${failed} 失敗`);
} else {
  console.log(`完成：共 ${PHOTO_IDS.length} 張 -> ${OUT_DIR}`);
}
