/**
 * 扫描 client/public/manhua-scenes|manhua-props/*.jpg → 重写 shared/manhuaDemoPublicReady.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shared/manhuaDemoPublicReady.ts");
const DIRS = [
  path.join(ROOT, "client/public/manhua-scenes"),
  path.join(ROOT, "client/public/manhua-props"),
];

function listJpgIds(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jpg"))
    .map((f) => f.replace(/\.jpg$/i, ""))
    .sort((a, b) => a.localeCompare(b));
}

const scenes = listJpgIds(DIRS[0]!);
const props = listJpgIds(DIRS[1]!);
const all = [...scenes, ...props];

const body = `/**
 * 已落盘到 client/public 的示范图 id（有 jpg 才进 UI）。
 * 由 \`pnpm run manhua:scene-prop-daily\`（COPY_PUBLIC=1）或
 * \`pnpm exec tsx scripts/sync-manhua-demo-public-ready.mts\` 刷新。
 * 未生成的目录槽禁止在资产墙 / 示范条展示「待生成」占位。
 */

export const MANHUA_DEMO_PUBLIC_READY_IDS: ReadonlySet<string> = new Set([
${scenes.map((id) => `  "${id}",`).join("\n")}${scenes.length && props.length ? "\n" : ""}${props
  .map((id) => `  "${id}",`)
  .join("\n")}
]);

export function isManhuaDemoAssetPublicReady(id: string | undefined | null): boolean {
  const key = String(id || "").trim();
  return Boolean(key && MANHUA_DEMO_PUBLIC_READY_IDS.has(key));
}
`;

fs.writeFileSync(OUT, body);
console.log(`synced ${all.length} ready ids → ${path.relative(ROOT, OUT)}`);
