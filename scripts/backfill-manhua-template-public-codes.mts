/**
 * 幂等回填：给 GCS approved（与 proposals 已批副本）里没有 publicCode 的模板卡铸码。
 * 2026-08-15 已对线上 14 张 approved 执行过一轮；恢复环境/新增无码卡时可重放。
 * 运行（Fly one-shot）：base64 本文件 → fly ssh console -a mvstudiopro -C
 *   "sh -c 'echo $B64|base64 -d>/tmp/bf.mts && cd /app && npx tsx /tmp/bf.mts'"
 * 机器休眠先 curl https://mvstudiopro.fly.dev/api/health 唤醒。
 */
import { randomBytes } from "node:crypto";
import { downloadGcsObject, listGcsObjectNamesByPrefix, uploadBufferToGcs } from "../server/services/gcs.js";

const BUCKET = process.env.GCS_BUCKET_NAME || "mv-studio-pro-vertex-video-temp";
const taken = new Set<string>();

function mint(): string {
  for (let i = 0; i < 24; i += 1) {
    const c = randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
    if (!taken.has(c)) return c;
  }
  for (let i = 0; i < 24; i += 1) {
    const c = randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
    if (!taken.has(c)) return c;
  }
  throw new Error("mint failed after 48 collisions");
}

async function pass(prefix: string, assign: boolean): Promise<string[]> {
  const names = (await listGcsObjectNamesByPrefix({ prefix, maxResults: 1000 })).filter((n) => /\.json$/i.test(n));
  const log: string[] = [];
  for (const name of names) {
    const { buffer } = await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${name}` });
    const json = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
    const code = String(json.publicCode || "").toUpperCase();
    if (/^[A-Z0-9]{4,8}$/.test(code)) { taken.add(code); log.push(`${name} 已有 ${code}`); continue; }
    if (!assign) continue;
    const fresh = mint();
    taken.add(fresh);
    json.publicCode = fresh;
    await uploadBufferToGcs({ objectName: name, buffer: Buffer.from(JSON.stringify(json, null, 2) + "\n", "utf8"), contentType: "application/json" });
    log.push(`${name} → ${fresh}`);
  }
  return log;
}

// 先扫一遍收集全部已占用码（含 approved），再回填缺码卡
await pass("manhua-template-learn/approved/", false);
console.log((await pass("manhua-template-learn/approved/", true)).join("\n"));
