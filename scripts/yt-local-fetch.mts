#!/usr/bin/env npx tsx
/**
 * 本机 YouTube 抓取（绕开 Fly/Vercel 机房 IP 黑名单）
 *
 * 用法：
 *   pnpm run yt:local-fetch -- "https://www.youtube.com/watch?v=xxxx"
 *
 * 依赖本机已安装 yt-dlp（brew install yt-dlp）。
 * 成功后得到 MP4，再上传到 Canvas「视频反推」方块。
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const url = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!url) {
  console.error('用法: pnpm run yt:local-fetch -- "<youtube-url>"');
  process.exit(1);
}

const outDir = path.resolve(process.cwd(), "downloads", "yt-local");
fs.mkdirSync(outDir, { recursive: true });
const outTpl = path.join(outDir, "%(title).80B-%(id)s.%(ext)s");

console.log("[yt-local-fetch] 使用本机出口 IP 下载（不经 Fly/Vercel）…");
console.log("[yt-local-fetch]", url);

const child = spawn(
  "yt-dlp",
  [
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    outTpl,
    "--no-playlist",
    url,
  ],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`\n[yt-local-fetch] 完成。文件在 ${outDir}`);
    console.log("下一步：打开 /canvas →「视频反推」方块 → 上传该 MP4 → 运行。");
  } else {
    console.error("\n[yt-local-fetch] 失败。请确认已安装 yt-dlp，且当前网络可访问 YouTube。");
  }
  process.exit(code ?? 1);
});
