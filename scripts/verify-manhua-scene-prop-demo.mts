/**
 * 核对场景/道具示范落盘缺口
 *   pnpm run manhua:scene-prop-verify
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CONTENT_LANE_LABEL_ZH,
  listManhuaDemoAssets,
} from "../shared/manhuaScenePropDemoCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REVIEW = path.join(os.homedir(), "Downloads", "2026Jul18", "scene-prop-review");

function existsAny(a: { id: string; kind: string }) {
  const name = `${a.id}.jpg`;
  const review = path.join(REVIEW, a.kind === "scene" ? "scenes" : "props", name);
  const pub = path.join(
    ROOT,
    "client/public",
    a.kind === "scene" ? "manhua-scenes" : "manhua-props",
    name,
  );
  return { review: fs.existsSync(review), pub: fs.existsSync(pub) };
}

const all = listManhuaDemoAssets();
const rows = all.map((a) => ({ ...a, ...existsAny(a) }));
const ok = rows.filter((r) => r.review || r.pub).length;
const byLane = new Map<string, { total: number; done: number }>();
for (const r of rows) {
  const cur = byLane.get(r.lane) || { total: 0, done: 0 };
  cur.total += 1;
  if (r.review || r.pub) cur.done += 1;
  byLane.set(r.lane, cur);
}

console.log(`scene/prop demo · done=${ok}/${all.length}`);
for (const [lane, v] of byLane) {
  const label = MANHUA_CONTENT_LANE_LABEL_ZH[lane as keyof typeof MANHUA_CONTENT_LANE_LABEL_ZH] || lane;
  console.log(`  ${label.padEnd(10)} ${v.done}/${v.total}`);
}
const missing = rows.filter((r) => !r.review && !r.pub);
if (missing.length) {
  console.log("\n缺口（前 12）：");
  for (const m of missing.slice(0, 12)) {
    console.log(`  - ${m.weight}/${m.lane}/${m.kind} ${m.id} ${m.nameZh}`);
  }
}
