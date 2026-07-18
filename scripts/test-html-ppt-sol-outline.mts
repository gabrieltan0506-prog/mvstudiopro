/**
 * 实跑：GPT-5.6 Sol 生成 8 页复杂清单 → 导出带图表动效 HTML。
 *   pnpm exec tsx scripts/test-html-ppt-sol-outline.mts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtmlPptDocument } from "../shared/htmlPptMaker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2] ?? "";
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, ".env.local"));

function keyLooksUsable(raw: string): boolean {
  const v = String(raw || "").trim();
  if (v.length < 20) return false;
  if (!v.isascii?.() && /[^\x00-\xff]/.test(v)) return false;
  if (/你的|your[_-]?api|xxx|placeholder|changeme/i.test(v)) return false;
  return true;
}

async function main() {
  const openai = String(process.env.OPENAI_API_KEY || "").trim();
  const evolink = String(process.env.EVOLINK_API_KEY || "").trim();
  if (openai && !keyLooksUsable(openai)) {
    delete process.env.OPENAI_API_KEY;
  }
  if (evolink && !keyLooksUsable(evolink)) {
    delete process.env.EVOLINK_API_KEY;
  }
  const hasKey = keyLooksUsable(String(process.env.OPENAI_API_KEY || "")) ||
    keyLooksUsable(String(process.env.EVOLINK_API_KEY || ""));
  if (!hasKey) {
    throw new Error(
      "本地 OPENAI_API_KEY/EVOLINK_API_KEY 不可用（占位符或非 ASCII）。请写入真实密钥后再跑 Sol 实测。",
    );
  }
  console.log(
    "key ok · openai=",
    keyLooksUsable(String(process.env.OPENAI_API_KEY || "")),
    "evolink=",
    keyLooksUsable(String(process.env.EVOLINK_API_KEY || "")),
  );

  const { generateHtmlPptOutline } = await import("../server/services/platformHtmlPptOutline.js");
  const result = await generateHtmlPptOutline({
    title: "小红书近7日趋势洞察",
    purposeZh: "品牌运营复盘会",
    pageCount: 8,
    styleId: "dark_research",
    briefZh:
      "窗口 2026/07/11–07/17。请产出可投屏复杂内容：核心洞察4点、蓝海词、活动趋势、品牌切入、流量趋势条、热搜Top条（多色）、转化建议。series 必须给可量化数字。至少含 bars + ring + line 各一页。",
  });

  console.log("model", result.model);
  console.log("deck", result.deckTitle);
  console.log("summary", result.summary);
  console.log(
    "pages",
    result.pages.map((p) => ({
      title: p.title,
      viz: p.viz,
      kpi: p.kpi,
      series: p.series?.length || 0,
      bullets: p.bullets?.length || 0,
    })),
  );

  const hasBars = result.pages.some((p) => p.viz === "bars" || (p.series?.length || 0) >= 3);
  const hasSeries = result.pages.filter((p) => (p.series?.length || 0) >= 2).length;
  if (result.pages.length < 8) throw new Error(`页数不足: ${result.pages.length}`);
  if (hasSeries < 3) throw new Error(`带 series 的页太少: ${hasSeries}`);
  if (!hasBars) console.warn("warn: 未显式 bars，将依赖渲染推断");

  const html = buildHtmlPptDocument({
    title: result.deckTitle || "小红书近7日趋势洞察",
    styleId: "dark_research",
    purposeZh: "品牌运营复盘会",
    pages: result.pages,
  });

  const checks = {
    linePath: html.includes("line-path") || html.includes("viz-line") || html.includes("hbar-fill"),
    countup: html.includes("countup"),
    shimmer: html.includes("shimmer"),
    multicolor: html.includes("#22d3ee") && html.includes("#a78bfa") && html.includes("#fb923c"),
    chartIn: html.includes("chart-in") || html.includes("fillBar"),
  };
  console.log("html checks", checks);
  if (!checks.multicolor || !checks.countup) {
    throw new Error("导出 HTML 缺少多色/数字跳动动效标记");
  }

  const outDir = path.join(os.homedir(), "Downloads", "2026Jul18", "html-ppt-online-test");
  fs.mkdirSync(outDir, { recursive: true });
  const outHtml = path.join(outDir, "sol-complex-8p.html");
  const outJson = path.join(outDir, "sol-complex-8p.json");
  fs.writeFileSync(outHtml, html);
  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.log("WROTE", outHtml);
  console.log("WROTE", outJson);
  console.log("OK_SOL_COMPLEX_PPT");
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
