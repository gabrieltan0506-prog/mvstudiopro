/**
 * 图文知识手册版式对比（本地、零付费请求、不生成图片）。
 *
 * 用法：corepack pnpm exec tsx scripts/knowledge-handbook-layout-compare.mts [--pdf 现成品.pdf] [--out 输出目录] [--base git引用]
 *   默认 --pdf /home/claude/assets/handbook-current.pdf，--out /home/claude/assets/handbook-new，--base HEAD
 *
 * 做什么：
 * 1. 用 pdfimages 从现成品 PDF 抽出前 8 张信息图当占位配图（本地文件经 puppeteer 请求拦截以 https 地址提供，不用 base64）；
 *    另用浏览器渲染一张 3840×2160 的密集小字测试图，按审校缩图派生件同法缩成 2048 JPEG，用来对比清晰度。
 * 2. 同一份 8 章假稿（长正文、短正文、表格、长列表、读图提示等）分别用「基线版式」（--base 引用里的 shared/knowledgeBooklet.ts）
 *    和「当前工作区版式」逐章排版、预分页、带全书页码打印，模拟导出流程（每章一个排版请求，图片压缩脚本与排版服务同一份）。
 * 3. 输出：old.pdf / new.pdf、各自的缩略总览 old-sheet.png / new-sheet.png、逐页留白指标 metrics.json、
 *    清晰度对比 clarity-old.png / clarity-new.png（两份成品实际内嵌的同一张测试图，裁同一区域放大到同宽）。
 */
import puppeteer, { type Page } from "puppeteer";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildKnowledgeBookletHtml, type KnowledgeBookletPage } from "../shared/knowledgeBooklet";
import { knowledgePublicationHead, knowledgePublicationImageModes } from "../shared/knowledgePublicationHtml";
import * as paginationModule from "../pdf-worker/knowledgeBookletPagination";
import * as compressionModule from "../pdf-worker/pdfImageCompression";

// pdf-worker 目录是 CommonJS 包：按命名或 default 两种形态取导出。
const pick = <T,>(mod: any, name: string): T => mod[name] ?? mod.default?.[name];
const finalizeKnowledgeBookletPagination = pick<(page: Page) => Promise<number>>(paginationModule, "finalizeKnowledgeBookletPagination");
const pdfImageCompressionScript = pick<(max: number) => string>(compressionModule, "pdfImageCompressionScript");
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePdf = arg("--pdf", "/home/claude/assets/handbook-current.pdf");
const out = arg("--out", "/home/claude/assets/handbook-new");
const baseRef = arg("--base", "HEAD");
const HOST = "https://handbook.local/";
mkdirSync(out, { recursive: true });
const work = join(out, "src");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. 占位配图：现成品内嵌的 1200×675 图 → 按缩图派生件规格存成 2048 长边 JPEG（放大只为版式对比，细节不比现成品多）。
execFileSync("pdfimages", ["-j", "-f", "1", "-l", "8", sourcePdf, join(work, "raw")]);
const raws = readdirSync(work).filter(n => n.startsWith("raw")).sort();
const files: Record<string, Buffer> = {};
for (const [i, name] of raws.entries())
  files[`img-${i + 1}.jpg`] = await sharp(join(work, name)).resize({ width: 2048, height: 2048, fit: "inside" }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-web-security"] });
const serve = async (page: Page) => {
  await page.setRequestInterception(true);
  page.on("request", req => {
    const url = req.url();
    if (!url.startsWith(HOST)) return void req.continue();
    const body = files[url.slice(HOST.length)];
    return void (body ? req.respond({ status: 200, contentType: "image/jpeg", body }) : req.respond({ status: 404, body: "" }));
  });
};

// 清晰度测试图：3840×2160 密集小字（同类信息图的典型字号），缩成 2048 派生件。
{
  const page = await browser.newPage();
  await page.setViewport({ width: 3840, height: 2160 });
  const cell = (i: number) => `<div style="border:2px solid #b64632;border-radius:12px;padding:14px;background:#fff8ee"><b style="font-size:40px;color:#b64632">要点 ${i + 1}：签约与收入分层</b><p style="font-size:26px;line-height:1.5;margin:8px 0">签约作者月入几千至三万元；坚持的新手月入几百到几千元；断更者仅几百元纯分成。数据为作者经验估计，个人差异较大。</p><table style="font-size:24px;border-collapse:collapse;width:100%">${["头部|年入百万至千万", "签约|月入几千至3万", "新手|月入几百到几千"].map(r => `<tr>${r.split("|").map(c => `<td style="border:1px solid #d8ac83;padding:4px 8px">${c}</td>`).join("")}</tr>`).join("")}</table></div>`;
  await page.setContent(`<body style="margin:0;font-family:'Noto Sans CJK SC',sans-serif;background:#f6ead8"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding:28px">${Array.from({ length: 12 }, (_, i) => cell(i)).join("")}</div></body>`);
  const shot = Buffer.from(await page.screenshot({ type: "png" }));
  files["clarity.jpg"] = await sharp(shot).resize({ width: 2048, height: 2048, fit: "inside" }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  await page.close();
}

// 2. 假稿：8 章，覆盖长/短正文、表格、长列表、只指向图中位置的读图提示。
// 按句生成（每句以「。」结束），与真实正文一样可在句界切分。
const para = (n: number, seed: string) => { const parts: string[] = []; let len = 0, k = 0; while (len < n) { const sentence = `${seed.slice(0, 8 + (k % 5) * 4)}，${seed.slice(8)}。`; parts.push(sentence); len += sentence.length; k++; } return parts.join(""); };
const bodies = [
  `## 签约前先看清门槛\n\n${para(420, "签约意味着平台愿意为你的作品投入推荐位与运营资源但前提是稳定更新与基本的订阅数据")}\n\n## 合同里最容易忽略的条款\n\n${para(520, "版权期限独家条款改编分成与违约责任要逐条看清楚必要时请有经验的作者帮忙把关")}\n\n## 不签约也能写吗\n\n${para(380, "免费平台靠广告分成起步门槛低但单价也低适合练笔与测试题材")}`,
  `## 一句话结论\n\n${para(110, "收入高度分层先确定能否稳定日更再谈题材与签约")}`,
  `## 三类平台对照\n\n|平台类型|收入来源|门槛|适合谁|\n|---|---|---|---|\n${Array.from({ length: 8 }, (_, i) => `|类型${i + 1}|订阅、广告与全勤奖励组合${i + 1}|日更四千字以上并保持三个月|有稳定时间的上班族${i + 1}|`).join("\n")}\n\n${para(160, "表中数字为公开资料与作者经验的概括各平台规则会调整以最新公告为准")}`,
  `## 开书前的十四项自查\n\n${Array.from({ length: 14 }, (_, i) => `- 第${i + 1}项：${para(28, "确认题材赛道读者画像更新节奏与存稿数量")}`).join("\n")}`,
  `## 题材选择的边界\n\n${para(560, "热门题材竞争大冷门题材读者少中间地带往往是新人最好的切入点要结合自己的知识储备")}`,
  `## 读者为什么追更\n\n${para(180, "追更动力来自悬念与情绪回报而不是信息量")}\n\n> 读图提示：对应左上角三幕结构卡\n\n> 图中右下栏已列钩子类型，此处说明用法。`,
  `## 数据复盘怎么做\n\n${para(700, "看追读率留存率与均订而不是只看收藏数每周固定复盘一次记录改动与结果")}\n\n## 复盘之后改什么\n\n${para(300, "先改开篇三章再改章节结尾钩子最后才动主线设定")}`,
  `## 写在最后\n\n${para(90, "坚持看产出不看年限")}`,
];
const headlines = ["签约逻辑与合同要点", "收入分层一句话", "平台类型对照", "开书自查清单", "题材边界", "追更动力", "数据复盘", "结语"];
const pages: KnowledgeBookletPage[] = bodies.map((body, i) => ({ id: `chapter-${i + 1}`, headline: headlines[i]!, body, imageUrl: `${HOST}img-${(i % raws.length) + 1}.jpg` }));
// 第 4 章换成清晰度测试图，便于在成品里同处比对。
pages[3]!.imageUrl = `${HOST}clarity.jpg`;
const title = "网文副业入门（版式对比假稿）";
const theme = "fusion_snow_monastery" as const;

// 基线版式：从 git 取旧 shared/knowledgeBooklet.ts，相对引用改指工作区同名模块（这些依赖模块本轮未改）。
const baseline = execFileSync("git", ["-C", repo, "show", `${baseRef}:shared/knowledgeBooklet.ts`], { encoding: "utf8" })
  .replace(/from (["'])\.\/([^"']+)\1/g, (_m, q, name) => `from ${q}${pathToFileURL(join(repo, "shared", name)).href}${q}`)
  .replace(/from (["'])marked\1/, (_m, q) => `from ${q}${import.meta.resolve("marked")}${q}`);
const baselinePath = join(tmpdir(), `knowledge-booklet-baseline-${Date.now()}.ts`);
writeFileSync(baselinePath, baseline);
const old = await import(pathToFileURL(baselinePath).href) as { buildKnowledgeBookletHtml: typeof buildKnowledgeBookletHtml };

const modes = knowledgePublicationImageModes(pages, "full");
const fragments = {
  old: pages.map((p, i) => old.buildKnowledgeBookletHtml({ title, theme, fragment: true, chapterOffset: i, pages: [p] })),
  new: pages.map((p, i) => buildKnowledgeBookletHtml({ title, theme, fragment: true, chapterOffset: i, imageMode: modes[i], pages: [p],
    next: pages[i + 1] ? { headline: pages[i + 1]!.headline, imageUrl: pages[i + 1]!.imageUrl, chapterNo: i + 2 } : null })),
};

// 与排版服务同序：载入 → 字体 → 图片解码 → 压缩脚本 → 打印媒体 → 定稿分页。
const prepare = async (page: Page, html: string) => {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");
  await page.evaluate(`Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})))`);
  await page.evaluate(pdfImageCompressionScript(2048));
  await page.emulateMediaType("print");
  return finalizeKnowledgeBookletPagination(page);
};
// 留白（两版同一口径）：各栏未用高度×栏宽 ÷ 版心面积；新版另报补白后的值。
const whitespace = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("#reading-pages .folio")).map(f => {
  const folio = f as HTMLElement, cs = getComputedStyle(folio);
  const area = (folio.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * (folio.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  const cols = Array.from(folio.querySelectorAll(".reading-column")) as HTMLElement[];
  const max = Number(folio.dataset.columnLimit) || cols[0]?.clientHeight || 0;
  const raw = cols.reduce((n, c) => n + Math.max(0, max - Array.from(c.children).reduce((m, u) => m + (u as HTMLElement).offsetHeight + parseFloat(getComputedStyle(u).marginBottom || "0"), 0)) * c.clientWidth, 0) / area;
  return { raw: Number(raw.toFixed(3)), filled: folio.dataset.whitespace ? Number(folio.dataset.whitespace) : null, kind: folio.classList.contains("spread-folio") ? "跨页" : folio.classList.contains("lead-folio") ? "图文" : "续页" };
}));

const metrics: Record<string, unknown> = {};
for (const version of ["old", "new"] as const) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1600 });
  await serve(page);
  const counts: number[] = [];
  for (const fragment of fragments[version]) counts.push(await prepare(page, knowledgePublicationHead(title) + fragment + "</body></html>"));
  const total = counts.reduce((a, b) => a + b, 0);
  const parts: string[] = [], pageMetrics: unknown[] = [];
  let offset = 0;
  for (const [i, fragment] of fragments[version].entries()) {
    await prepare(page, knowledgePublicationHead(title, { offset, total, count: counts[i]! }) + fragment + "</body></html>");
    pageMetrics.push(...await whitespace(page));
    const path = join(work, `${version}-${i}.pdf`);
    writeFileSync(path, Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } })));
    parts.push(path);
    offset += counts[i]!;
  }
  await page.close();
  execFileSync("pdfunite", [...parts, join(out, `${version}.pdf`)]);
  execFileSync("pdftoppm", ["-r", "16", "-png", join(out, `${version}.pdf`), join(work, `${version}-thumb`)]);
  const thumbs = readdirSync(work).filter(n => n.startsWith(`${version}-thumb`)).sort().map(n => join(work, n));
  execFileSync("montage", [...thumbs, "-tile", "8x", "-geometry", "+6+6", "-background", "#888", join(out, `${version}-sheet.png`)]);
  metrics[version] = { chapters: pages.length, pages: total, perChapter: counts, imageModes: version === "new" ? modes : undefined, pagesDetail: pageMetrics,
    maxRawWhitespace: Math.max(...pageMetrics.map(m => (m as { raw: number }).raw)),
    maxFilledWhitespace: version === "new" ? Math.max(...pageMetrics.map(m => (m as { filled: number }).filled ?? 0)) : undefined,
    pdfBytes: readFileSync(join(out, `${version}.pdf`)).length };
}

// 3. 清晰度：取两份成品里第 4 章（测试图）实际内嵌的图片，裁同一相对区域（左上 1/4 宽 × 1/4 高），统一放大到 1400 宽对比。
const chapterFourPage = (version: "old" | "new") => (metrics[version] as { perChapter: number[] }).perChapter.slice(0, 3).reduce((a, b) => a + b, 0) + 1;
for (const version of ["old", "new"] as const) {
  const n = String(chapterFourPage(version));
  execFileSync("pdfimages", ["-png", "-f", n, "-l", n, join(out, `${version}.pdf`), join(work, `${version}-embedded`)]);
  const embedded = readdirSync(work).filter(name => name.startsWith(`${version}-embedded`)).sort();
  const sizes = await Promise.all(embedded.map(async name => ({ name, meta: await sharp(join(work, name)).metadata() })));
  const main = sizes.sort((x, y) => (y.meta.width! * y.meta.height!) - (x.meta.width! * x.meta.height!))[0]!;
  (metrics[version] as Record<string, unknown>).clarityEmbedded = `${main.meta.width}x${main.meta.height}`;
  const w = main.meta.width!, h = main.meta.height!;
  await sharp(join(work, main.name)).extract({ left: 0, top: 0, width: Math.round(w / 4), height: Math.round(h / 4) }).resize({ width: 1400, kernel: "lanczos3" }).toFile(join(out, `clarity-${version}.png`));
}
writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
await browser.close();
rmSync(baselinePath, { force: true });
console.log(JSON.stringify({ out, old: { pages: (metrics.old as any).pages, maxRawWhitespace: (metrics.old as any).maxRawWhitespace, pdfBytes: (metrics.old as any).pdfBytes }, new: { pages: (metrics.new as any).pages, maxFilledWhitespace: (metrics.new as any).maxFilledWhitespace, modes, pdfBytes: (metrics.new as any).pdfBytes } }, null, 2));
