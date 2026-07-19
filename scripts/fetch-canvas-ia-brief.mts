/**
 * 从 Fly 拉取 /canvas IA 简报（Responses Pro），写入 ~/Downloads/2026Jul19/canvas-ia-brief.md
 *
 *   FLY_ORIGIN=https://api.mvstudiopro.com pnpm exec tsx scripts/fetch-canvas-ia-brief.mts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FLY = String(process.env.FLY_ORIGIN || "https://api.mvstudiopro.com").replace(/\/$/, "");
const OUT = path.join(os.homedir(), "Downloads", "2026Jul19", "canvas-ia-brief.md");

async function main() {
  console.log(`→ ${FLY}/api/jobs?op=canvasiabrief`);
  const res = await fetch(`${FLY}/api/jobs?op=canvasiabrief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(240_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    markdown?: string;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.markdown) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const header = `# /canvas 双入口 IA 简报\n\n> 由 Fly · GPT-5.6 Sol Responses Pro 生成 · ${new Date().toISOString()}\n\n`;
  fs.writeFileSync(OUT, `${header}${json.markdown.trim()}\n`);
  console.log(`ok → ${OUT} (${json.markdown.length} chars)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
