/**
 * 一键发文：编译 → 等线上真的更新 → 校验 200 → 推 IndexNow。
 *
 * 为什么要串成一条：IndexNow 推过去的 URL 如果是 404 或旧版，会扣站点信任分，
 * 而部署有延迟——手动跑就容易「合并完立刻推」，推到的还是上一版。这里强制先探活。
 *
 * 用法：
 *   pnpm blog:publish            编译 + 等上线 + 推送（推荐；提交合并后跑）
 *   pnpm blog:publish --no-build 跳过编译，只探活 + 推送
 *   pnpm blog:publish --dry      全流程但不真正发 IndexNow
 *   pnpm blog:publish --wait 20  最多等 20 分钟（默认 15）
 *
 * 注意：本脚本不碰 git。正确顺序是
 *   1) 写 content/blog/xxx.md、放 client/public/blog-assets/xxx/
 *   2) pnpm blog:publish --no-ping   （只编译，见下）或直接 pnpm blog:build
 *   3) 提交 + 合并 + 等部署
 *   4) pnpm blog:publish --no-build  探活并推送
 * 想省事就在部署完成后直接跑 `pnpm blog:publish`，它会重编译一次再探活。
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://www.mvstudiopro.com";
const SRC = path.join(ROOT, "content", "blog");

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const dryRun = has("--dry");
const skipBuild = has("--no-build");
const skipPing = has("--no-ping");
const waitMinutes = (() => {
  const i = args.indexOf("--wait");
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 15;
})();

/** 文章 slug ← content/blog 下的文件名；用它拼线上 URL 做探活 */
async function listSlugs(): Promise<string[]> {
  const files = await fs.readdir(SRC).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
}

/** 只探「今天日期」的文章：老文章早就在线上，没必要每次都等 */
async function todaySlugs(slugs: string[]): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  for (const slug of slugs) {
    const raw = await fs.readFile(path.join(SRC, `${slug}.md`), "utf8").catch(() => "");
    const date = raw.match(/^date:\s*(\S+)/m)?.[1]?.trim() || "";
    if (date === today) out.push(slug);
  }
  return out;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!skipBuild) {
    console.log("[publish] 编译静态页与 sitemap…");
    const { stdout } = await run("pnpm", ["blog:build"], { cwd: ROOT, maxBuffer: 8 << 20 });
    console.log(stdout.trim().split("\n").slice(-3).join("\n"));
  }

  const slugs = await listSlugs();
  const targets = await todaySlugs(slugs);
  if (!targets.length) {
    console.log("[publish] 今天没有新文章（front matter 的 date 不是今天），只推 sitemap 里的更新");
  } else {
    console.log(`[publish] 今天的文章：${targets.join("、")}`);
  }

  // 探活：部署没上线就推 IndexNow 等于推 404，会扣信任分
  const urls = targets.map((s) => `${SITE}/blog/${s}`);
  if (urls.length) {
    const deadline = Date.now() + waitMinutes * 60_000;
    const pending = new Set(urls);
    console.log(`[publish] 等待线上生效（最多 ${waitMinutes} 分钟）…`);
    while (pending.size && Date.now() < deadline) {
      for (const u of [...pending]) {
        if (await headOk(u)) {
          console.log(`  ✓ ${u}`);
          pending.delete(u);
        }
      }
      if (pending.size) await new Promise((r) => setTimeout(r, 15_000));
    }
    if (pending.size) {
      console.error(`[publish] 以下页面仍未上线，已中止推送（避免推 404 扣信任分）：`);
      for (const u of pending) console.error(`  ✗ ${u}`);
      console.error(`[publish] 部署完成后重跑：pnpm blog:publish --no-build`);
      process.exit(1);
    }
  }

  if (skipPing) {
    console.log("[publish] --no-ping，跳过 IndexNow");
    return;
  }
  console.log("[publish] 推送 IndexNow…");
  const { stdout } = await run("pnpm", ["blog:ping", ...(dryRun ? ["--dry"] : [])], {
    cwd: ROOT,
    maxBuffer: 8 << 20,
  });
  console.log(stdout.trim());
  console.log("[publish] 完成。Google 不吃 IndexNow，走 Search Console 或等 sitemap 抓取。");
}

main().catch((err) => {
  console.error(`[publish] 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
