/**
 * 漫剧节奏模板定时扫描：读公开报道 URL → 写出/更新 proposals（绝不改审定库）。
 * 用法：pnpm run manhua:template-scan
 *
 * 环境：
 * - MANHUA_TEMPLATE_SCAN_DRY=1 只打印不写盘
 * - 无网络或抓取失败时写 stub 提案（status=proposed，note 标明待人工补全）
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../shared/manhuaViralTemplateBank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LAB = path.join(ROOT, "docs/manhua-template-lab");
const SOURCES = path.join(LAB, "sources.json");
const PROPOSALS = path.join(LAB, "proposals");
const CHANGELOG = path.join(LAB, "CHANGELOG.md");

const DRY = process.env.MANHUA_TEMPLATE_SCAN_DRY === "1";

type SourceRow = { id: string; url: string; labelZh?: string };

function slugFromUrl(url: string): string {
  const h = createHash("sha1").update(url).digest("hex").slice(0, 8);
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/\W+/g, "_");
    return `tpl_scan_${host.slice(0, 24)}_${h}`;
  } catch {
    return `tpl_scan_${h}`;
  }
}

function guessLane(text: string): ManhuaViralTemplateLane {
  const t = text.toLowerCase();
  if (/种田|边关|古言|开荒/.test(t)) return "古言种田";
  if (/系统|吞噬|进化|觉醒/.test(t)) return "系统觉醒";
  if (/电竞|游戏|操作|竞技/.test(t)) return "游戏竞技";
  if (/甜宠|恋爱|霸总/.test(t)) return "甜宠";
  if (/悬疑|权谋|宫斗/.test(t)) return "悬疑权谋";
  if (/沙雕|搞笑|反差/.test(t)) return "搞笑沙雕";
  return "爽文逆袭";
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "mvstudiopro-manhua-template-scan/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } finally {
    clearTimeout(timer);
  }
}

function buildStubCard(source: SourceRow, snippet: string, ok: boolean): ManhuaViralTemplateCard {
  const today = new Date().toISOString().slice(0, 10);
  const laneZh = guessLane(`${source.labelZh || ""} ${snippet}`);
  const id = slugFromUrl(source.url);
  return {
    id,
    nameZh: (source.labelZh || "公开报道节奏草案").slice(0, 32),
    laneZh,
    summaryZh: ok
      ? "扫描草案：请人工补全节拍格与钩子后再批准进库。"
      : "抓取失败草案：请据原文人工填写后批准进库。",
    hook3sZh: "待补：前 3 秒可见冲突（问题/异常/压迫动作）。",
    beatGrid: [
      { atSec: 0, conflictZh: "开场压迫", visualZh: "待补可见动作" },
      { atSec: 60, conflictZh: "中段反转", visualZh: "待补可见动作" },
      { atSec: 120, conflictZh: "高潮对抗", visualZh: "待补可见动作" },
      { atSec: 165, conflictZh: "片尾钩子", visualZh: "待补未揭答案画面" },
    ],
    scenePoolHints: [],
    castShape: {
      leadDesireZh: "待补",
      pressureZh: "待补",
    },
    densityHints: {
      minBodyChars: 280,
      minDialogueLines: 8,
      minLocationHits: 2,
    },
    sourceRefs: [
      {
        url: source.url,
        fetchedAt: today,
        noteZh: ok
          ? `自动扫描摘要：${snippet.slice(0, 80)}`
          : "抓取失败，仅登记 URL",
      },
    ],
    status: "proposed",
    updatedAt: new Date().toISOString(),
  };
}

async function appendChangelog(id: string, note: string) {
  const line = `| ${new Date().toISOString().slice(0, 10)} | scan-proposed | ${id} | ${note} |\n`;
  try {
    await fs.appendFile(CHANGELOG, line, "utf8");
  } catch {
    /* ignore */
  }
}

async function main() {
  const raw = await fs.readFile(SOURCES, "utf8");
  const parsed = JSON.parse(raw) as { sources?: SourceRow[] };
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  if (!sources.length) {
    console.error("no sources in docs/manhua-template-lab/sources.json");
    process.exit(1);
  }
  await fs.mkdir(PROPOSALS, { recursive: true });

  let wrote = 0;
  for (const source of sources) {
    if (!source?.url) continue;
    let snippet = "";
    let ok = false;
    try {
      snippet = await fetchText(source.url);
      ok = snippet.length > 40;
    } catch (e) {
      console.warn(`[skip-fetch] ${source.url}:`, e instanceof Error ? e.message : e);
    }
    const card = buildStubCard(source, snippet, ok);
    const validated = parseManhuaViralTemplateCard(card);
    if (!validated) {
      console.warn(`[invalid] ${card.id}`);
      continue;
    }
    // 若审定库已有同 id，跳过写提案（避免覆盖认知）
    const outPath = path.join(PROPOSALS, `${validated.id}.json`);
    let skip = false;
    try {
      const prev = JSON.parse(await fs.readFile(outPath, "utf8")) as { status?: string };
      if (prev.status === "approved") skip = true;
    } catch {
      /* new file */
    }
    if (skip) {
      console.log(`[keep] ${validated.id} already marked approved in proposals`);
      continue;
    }
    const body = `${JSON.stringify(validated, null, 2)}\n`;
    if (DRY) {
      console.log(`[dry] would write ${outPath}`);
    } else {
      await fs.writeFile(outPath, body, "utf8");
      await appendChangelog(validated.id, ok ? "fetch-ok stub" : "fetch-fail stub");
      console.log(`[wrote] ${outPath}`);
    }
    wrote += 1;
  }
  console.log(`manhua-template-scan done · cards=${wrote} dry=${DRY ? "1" : "0"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
