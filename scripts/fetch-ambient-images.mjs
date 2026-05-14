/**
 * 將環境底圖從 Unsplash 拉取到 client/public/ambient/，與 client/src/lib/ambientSceneBackgrounds.ts 使用同一批 photoId。
 * 用法：pnpm run ambient:fetch-images
 * 注意：Unsplash 上已下架的 photo-* 在 CDN 會 404，需換 ID 後重新下載。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "client", "public", "ambient");

/** 與 ambientSceneBackgrounds 中 `localAmbient("…")` 去重後一致；改表時請同步 */
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

async function downloadOne(photoId) {
  const dest = path.join(OUT_DIR, `${photoId}.jpg`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log(`skip (exists) ${photoId}.jpg`);
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
