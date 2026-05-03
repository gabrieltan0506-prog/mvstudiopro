/**
 * 战略研报 · HTML 交互导出模板
 *
 * 用户决策（原话）：
 *   "直接讓用戶下載PDF跟HTML的選項就好，除非檔案很大，超過 10 MB，
 *   在採用壓縮成 zip 下載。"
 *
 * 路径定位：
 *   - PDF（PR pdf-v2-platformpage-mode 之后）：MyReportsPage 阅读模式 React 渲染
 *     → document.documentElement.cloneNode(true) → mvAnalysis.downloadPlatformPdf → pdf-worker
 *   - HTML（本文件）：server-side 拼单文件 HTML，内联 echarts.min.js 给浏览器跑
 *     交互图（hover、tooltip、legend 切换、缩放等）。两条路径互不干扰。
 *
 * 输出：单文件完整 HTML，结构：
 *   <!doctype html><html><head>
 *     <meta charset="utf-8"><title>...</title>
 *     <style>5 套主题 CSS（buildHtmlPalette） + 排版</style>
 *     <script>echarts.min.js inline 进来（构建期从 node_modules 读）</script>
 *   </head><body data-theme="${pdfStyle}">
 *     <header class="cover">封面</header>
 *     <article>${marked HTML，含 figure scene-figure + figure chart-figure echart-mount}</article>
 *     <footer>...</footer>
 *     <script>初始化所有 .echart-mount</script>
 *   </body></html>
 *
 * 设计纪律：
 *   - 不引入新依赖（echarts 一个就够；jszip 在路由层处理 zip 压缩）
 *   - 不在前端用 React 渲染（纯字符串拼接，单文件离线可用）
 *   - 图片直接 https URL（场景图 / 封面 已经是 GCS 公网 URL）
 *   - PR #330 修过 marked raw HTML pass-through，本文件的 marked 配置默认 GFM
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

import {
  injectChartMountsIntoMarkdown,
  type EChartsTheme,
  type ExtractedChart,
} from "./echartsServerRender";

// ESM (package.json type=module) 下没有 __dirname，要用 import.meta.url 反推
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

marked.setOptions({ gfm: true });

export type HtmlPdfStyle =
  | "spring-mint"
  | "neon-tech"
  | "sunset-coral"
  | "ocean-fresh"
  | "business-bright";

export interface HtmlReportCover {
  imageUrl?: string;
  title?: string;
  subtitle?: string;
  issue?: string;
  date?: string;
  abstract?: string;
}

/** 可選：平台橫版分鏡表等「純圖 URL」— 報告內以 DOM 疊字，避免像素中文（Cam4-1 / Cam5） */
export interface HtmlReportStoryboardSheet {
  imageUrl: string;
  /** 疊加標題；缺省時用 {@link HtmlReportOpts.documentTitle} 或 cover.title */
  reportTitle?: string;
  /** 燈光／執行細節（與平台頁 executionDetails 對齊） */
  lightingDetails?: string;
  executionDetails?: string;
  /** 與生圖相同之劇本全文，PDF 網格格數與 prompt 一致（優先於 storyboardSteps） */
  scriptContextForPanels?: string;
  /** 僅分鏡步驟文本；無 scriptContextForPanels 時用於算格數 */
  storyboardSteps?: string;
}

/** Cam9：小紅書圖文雙卡 — 純圖底 + HTML 疊加標籤（與分鏡表同級視圖解耦） */
export interface HtmlReportXhsDualNote {
  imageUrl: string;
  reportTitle?: string;
  /** X11：價值卡兩條（可選；缺省由 scriptContext 或通用回退推算） */
  xhsBullet1Title?: string;
  xhsBullet1Desc?: string;
  xhsBullet2Title?: string;
  xhsBullet2Desc?: string;
}

export interface HtmlReportOpts {
  style?: HtmlPdfStyle;
  cover?: HtmlReportCover;
  /** 自定义 title（写到 <title>） */
  documentTitle?: string;
  /** 封面與正文之間可選插入分鏡圖文參考（單張原生大圖） */
  storyboardSheet?: HtmlReportStoryboardSheet;
  /** 小紅書圖文參考（單張原生大圖，簡體字在畫內） */
  xhsDualNote?: HtmlReportXhsDualNote;
}

/**
 * Cam7：從作品 `metadata`（及可選的匯出請求覆寫）還原分鏡圖文參考區塊（AI 原生 2×4 大圖，HTML 僅嵌圖）。
 *
 * 讀取順序：
 * - 巢狀 `metadata.storyboardSheetExport`（建議寫入格式）
 * - 扁平欄位 `storyboardSheetImageUrl`、`storyboardSheetScriptContextForPanels` 等（腳本/兼容）
 * - `requestOverride` 中非空字串欄位覆寫對應鍵（最後一哩強制對齊）
 */
export function resolveHtmlReportStoryboardSheet(
  meta: Record<string, unknown> | null | undefined,
  requestOverride?: Partial<HtmlReportStoryboardSheet> | null,
): HtmlReportStoryboardSheet | undefined {
  const m =
    meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const nestedRaw = m["storyboardSheetExport"];
  const n =
    nestedRaw && typeof nestedRaw === "object" && !Array.isArray(nestedRaw)
      ? (nestedRaw as Record<string, unknown>)
      : {};

  const pickStr = (v: unknown) => String(v ?? "").trim();

  const kindForBlock = pickStr(n["kind"]);
  if (kindForBlock === "xiaohongshu_dual_note") return undefined;

  let imageUrl = pickStr(n["imageUrl"] ?? m["storyboardSheetImageUrl"]);
  let scriptContextForPanels = pickStr(
    n["scriptContextForPanels"] ?? m["storyboardSheetScriptContextForPanels"],
  );
  let storyboardSteps = pickStr(n["storyboardSteps"] ?? m["storyboardSheetStoryboardSteps"]);
  let lightingDetails = pickStr(n["lightingDetails"] ?? m["storyboardSheetLightingDetails"]);
  let executionDetailsPick = pickStr(n["executionDetails"] ?? m["storyboardSheetExecutionDetails"]);
  let reportTitle = pickStr(n["reportTitle"] ?? m["storyboardSheetReportTitle"]);

  if (requestOverride && typeof requestOverride === "object") {
    const o = requestOverride;
    if (pickStr(o.imageUrl)) imageUrl = pickStr(o.imageUrl);
    if (pickStr(o.scriptContextForPanels)) scriptContextForPanels = pickStr(o.scriptContextForPanels);
    if (pickStr(o.storyboardSteps)) storyboardSteps = pickStr(o.storyboardSteps);
    if (pickStr(o.lightingDetails)) lightingDetails = pickStr(o.lightingDetails);
    if (pickStr(o.executionDetails)) executionDetailsPick = pickStr(o.executionDetails);
    if (pickStr(o.reportTitle)) reportTitle = pickStr(o.reportTitle);
  }

  if (!imageUrl) return undefined;

  const sheet: HtmlReportStoryboardSheet = { imageUrl };
  if (reportTitle) sheet.reportTitle = reportTitle;
  if (lightingDetails) sheet.lightingDetails = lightingDetails;
  if (executionDetailsPick) sheet.executionDetails = executionDetailsPick;

  if (scriptContextForPanels) {
    sheet.scriptContextForPanels = scriptContextForPanels;
  } else if (storyboardSteps) {
    sheet.storyboardSteps = storyboardSteps;
  }

  return sheet;
}

/**
 * Cam9：從 metadata.storyboardSheetExport（kind=xiaohongshu_dual_note）或請求覆寫還原小紅書區塊。
 */
export function resolveHtmlReportXhsDualNote(
  meta: Record<string, unknown> | null | undefined,
  requestOverride?: Partial<HtmlReportXhsDualNote> | null,
): HtmlReportXhsDualNote | undefined {
  const m =
    meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const nestedRaw = m["storyboardSheetExport"];
  const n =
    nestedRaw && typeof nestedRaw === "object" && !Array.isArray(nestedRaw)
      ? (nestedRaw as Record<string, unknown>)
      : {};

  const pickStr = (v: unknown) => String(v ?? "").trim();

  let kind = pickStr(n["kind"]);
  let imageUrl = pickStr(n["imageUrl"]);
  let reportTitle = pickStr(n["reportTitle"] ?? m["xhsDualNoteReportTitle"]);

  if (requestOverride && typeof requestOverride === "object") {
    const o = requestOverride;
    if (pickStr(o.imageUrl)) imageUrl = pickStr(o.imageUrl);
    if (pickStr(o.reportTitle)) reportTitle = pickStr(o.reportTitle);
  }

  if (!imageUrl) return undefined;

  const isXhsKind = kind === "xiaohongshu_dual_note";
  const explicitXhsOverride = !!(requestOverride && pickStr(requestOverride.imageUrl));
  if (!isXhsKind && !explicitXhsOverride) return undefined;

  return reportTitle ? { imageUrl, reportTitle } : { imageUrl };
}

// ─── 5 套主题色（与 client/components/ReportRenderer.tsx THEME_PALETTES 对齐） ─

interface HtmlPalette {
  bg: string;
  bgElev: string;
  textMain: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  accent: string;
  navy: string;
  rule: string;
  rowAlt: string;
  tableHeadBg: string;
  tableHeadText: string;
  coverBg: string;
  coverGold: string;
  h2Bg: string;
  h2Text: string;
  sectionStripe: string;
  starColor: string;
  confidential: string;
}

function buildHtmlPalette(style: HtmlPdfStyle): HtmlPalette {
  if (style === "spring-mint") {
    return {
      bg: "#FFFFFF",
      bgElev: "#F0FDF4",
      textMain: "#0F172A",
      textMuted: "#64748B",
      primary: "#10B981",
      primarySoft: "#34D399",
      accent: "#FB7185",
      navy: "#064E3B",
      rule: "#D1FAE5",
      rowAlt: "#ECFDF5",
      tableHeadBg: "#10B981",
      tableHeadText: "#FFFFFF",
      coverBg: "#ECFDF5",
      coverGold: "#FB7185",
      h2Bg: "linear-gradient(90deg, #10B981 0%, #34D399 60%, #6EE7B7 100%)",
      h2Text: "#FFFFFF",
      sectionStripe: "#FB7185",
      starColor: "#FB7185",
      confidential: "#E11D48",
    };
  }
  if (style === "neon-tech") {
    return {
      bg: "#FAFBFF",
      bgElev: "#F5F3FF",
      textMain: "#1E1B4B",
      textMuted: "#6B7280",
      primary: "#7C3AED",
      primarySoft: "#A855F7",
      accent: "#06B6D4",
      navy: "#1E1B4B",
      rule: "#E9D5FF",
      rowAlt: "#F5F3FF",
      tableHeadBg: "#5B21B6",
      tableHeadText: "#FFFFFF",
      coverBg: "#1E1B4B",
      coverGold: "#06B6D4",
      h2Bg: "linear-gradient(90deg, #7C3AED 0%, #A855F7 50%, #06B6D4 100%)",
      h2Text: "#FFFFFF",
      sectionStripe: "#06B6D4",
      starColor: "#06B6D4",
      confidential: "#F472B6",
    };
  }
  if (style === "sunset-coral") {
    return {
      bg: "#FFFAF5",
      bgElev: "#FFF7ED",
      textMain: "#3C1361",
      textMuted: "#7C5C8B",
      primary: "#8B5CF6",
      primarySoft: "#A78BFA",
      accent: "#FB923C",
      navy: "#3C1361",
      rule: "#FED7AA",
      rowAlt: "#FFF1E6",
      tableHeadBg: "#7C3AED",
      tableHeadText: "#FFFFFF",
      coverBg: "#FFEDD5",
      coverGold: "#8B5CF6",
      h2Bg: "linear-gradient(90deg, #FB923C 0%, #F472B6 50%, #8B5CF6 100%)",
      h2Text: "#FFFFFF",
      sectionStripe: "#FB923C",
      starColor: "#FB923C",
      confidential: "#9F1239",
    };
  }
  if (style === "ocean-fresh") {
    return {
      bg: "#F8FAFF",
      bgElev: "#EFF6FF",
      textMain: "#0C1A3D",
      textMuted: "#475569",
      primary: "#2563EB",
      primarySoft: "#3B82F6",
      accent: "#FACC15",
      navy: "#0C1A3D",
      rule: "#DBEAFE",
      rowAlt: "#EFF6FF",
      tableHeadBg: "#2563EB",
      tableHeadText: "#FFFFFF",
      coverBg: "#DBEAFE",
      coverGold: "#FACC15",
      h2Bg: "linear-gradient(90deg, #2563EB 0%, #38BDF8 100%)",
      h2Text: "#FFFFFF",
      sectionStripe: "#FACC15",
      starColor: "#FACC15",
      confidential: "#B91C1C",
    };
  }
  // business-bright
  return {
    bg: "#F8FAFC",
    bgElev: "#FFFFFF",
    textMain: "#0F1B2D",
    textMuted: "#55657A",
    primary: "#1F3A5F",
    primarySoft: "#3A5A85",
    accent: "#C9A858",
    navy: "#0F1B2D",
    rule: "#D8E1EC",
    rowAlt: "#EDF2F7",
    tableHeadBg: "#1F3A5F",
    tableHeadText: "#FFFFFF",
    coverBg: "#EAF0F6",
    coverGold: "#C9A858",
    h2Bg: "linear-gradient(90deg, #1F3A5F 0%, #2D4A6F 100%)",
    h2Text: "#FFFFFF",
    sectionStripe: "#C9A858",
    starColor: "#C9A858",
    confidential: "#A52A2A",
  };
}

// ─── echarts.min.js 内联缓存 ───────────────────────────────────────────────
//
// 启动期一次性读 node_modules/echarts/dist/echarts.min.js（约 1MB），缓存到
// 模块级变量。多次导出同份内容只读一次磁盘。
let cachedEchartsScript: string | null = null;
let cachedEchartsScriptError: string | null = null;

function readEchartsScript(): { script: string | null; error: string | null } {
  if (cachedEchartsScript) return { script: cachedEchartsScript, error: null };
  if (cachedEchartsScriptError) return { script: null, error: cachedEchartsScriptError };

  // 尝试从 node_modules 读（生产 / 开发都适用）
  const candidates = [
    path.resolve(process.cwd(), "node_modules", "echarts", "dist", "echarts.min.js"),
    path.resolve(__dirname, "..", "..", "node_modules", "echarts", "dist", "echarts.min.js"),
  ];
  for (const p of candidates) {
    try {
      const buf = fs.readFileSync(p, "utf8");
      if (buf && buf.length > 50_000) {
        cachedEchartsScript = buf;
        return { script: cachedEchartsScript, error: null };
      }
    } catch { /* try next */ }
  }
  cachedEchartsScriptError = `echarts.min.js 在以下路径都没找到：\n${candidates.join("\n")}`;
  console.warn(`[htmlReportTemplate] ${cachedEchartsScriptError}`);
  return { script: null, error: cachedEchartsScriptError };
}

// ─── markdown → HTML（保留 raw HTML，跟 PR #330 修复一致） ──────────────────

function parseMarkdownToHtml(markdownContent: string): string {
  const raw = String(markdownContent || "").trim();
  if (!raw) return "<p>（无正文）</p>";
  return marked.parse(raw, { async: false }) as string;
}

function enhanceTables(html: string): string {
  return html.replace(
    /<(td|th)>([\s\S]*?)<\/\1>/g,
    (m, tag: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const isNumeric =
        text.length > 0 &&
        text.length < 24 &&
        /^[\d.,+\-%／/×倍分元万千亿点位天月年个日小时秒级]+$/.test(text.replace(/\s/g, ""));
      const isPctChange = /^[+\-]\s*\d+(\.\d+)?\s*%$/.test(text);
      const cls: string[] = [];
      if (isNumeric || isPctChange) cls.push("num");
      if (isPctChange) cls.push(text.startsWith("-") ? "neg" : "pos");
      return `<${tag}${cls.length ? ` class="${cls.join(" ")}"` : ""}>${inner}</${tag}>`;
    },
  );
}

// ─── 封面（HTML 离线版，9:16 杂志风；样式简化到屏幕阅读） ───────────────────

function buildHtmlStoryboardSheetSection(data: HtmlReportStoryboardSheet, fallbackTitle: string): string {
  const safeUrl = String(data.imageUrl || "")
    .trim()
    .replace(/"/g, "&quot;");
  if (!safeUrl) return "";
  const safeTitle = escapeHtml(String(data.reportTitle || fallbackTitle || "战略情报报告").trim());

  return `<section class="report-storyboard-visual-ref" aria-label="分镜图文参考" style="padding:40px;background:#0a0a0a;border-radius:20px;margin:40px 0;page-break-inside:avoid;border:1px solid rgba(255,255,255,0.1);">
  <div style="margin-bottom:30px;border-left:6px solid #10B981;padding-left:20px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;">
    <h2 style="color:#fff;margin:0;font-size:24px;font-family:'Noto Serif CJK SC',Georgia,serif;">${safeTitle} - 分镜图文参考</h2>
    <span style="color:#10B981;font-size:12px;border:1px solid rgba(16,185,129,0.3);padding:4px 10px;border-radius:20px;">AI 原生排版</span>
  </div>
  <div style="width:100%;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.5);background:#000;">
    <img src="${safeUrl}" alt="" style="width:100%;display:block;object-fit:contain;" />
  </div>
</section>`;
}

/** 小紅書圖文參考：畫內已含簡體排版，HTML 僅嵌圖 */
export function buildHtmlXhsNoteSection(data: HtmlReportXhsDualNote, fallbackTitle: string): string {
  if (!data || !String(data.imageUrl || "").trim()) return "";
  const safeUrl = String(data.imageUrl).trim().replace(/"/g, "&quot;");
  const safeTitle = escapeHtml(String(data.reportTitle || fallbackTitle || "战略情报报告").trim());

  return `<section class="report-xhs-visual-ref" aria-label="小红书图文参考" style="padding:40px;background:#0a0a0a;border-radius:20px;margin:40px 0;page-break-inside:avoid;border:1px solid rgba(255,36,66,0.15);">
  <div style="margin-bottom:30px;border-left:6px solid #ff2442;padding-left:20px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;">
    <h2 style="color:#fff;margin:0;font-size:24px;font-family:'Noto Serif CJK SC',Georgia,serif;">${safeTitle} - 小红书图文参考</h2>
    <span style="color:#ff2442;font-size:12px;border:1px solid rgba(255,36,66,0.35);padding:4px 10px;border-radius:20px;">AI 原生排版</span>
  </div>
  <div style="width:100%;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.5);background:#000;">
    <img src="${safeUrl}" alt="" style="width:100%;display:block;object-fit:contain;" />
  </div>
</section>`;
}

function buildHtmlCover(palette: HtmlPalette, cover: HtmlReportCover, style: HtmlPdfStyle): string {
  const safeBg = String(cover.imageUrl || "").replace(/"/g, "&quot;");
  const safeTitle = escapeHtml(cover.title || "战略情报报告");
  const safeSubtitle = escapeHtml(cover.subtitle || "EXCLUSIVE STRATEGIC INTELLIGENCE");

  // GPT-Image-2 / DALL-E 等模型无法在像素层稳定渲染中文：封面底图仅作「纯视觉」；
  // 标题与副标题由本段 HTML + CSS 叠加入 PDF/HTML，由系统字体渲染清晰中文。
  if (safeBg) {
    return `<section class="cover-page cover-image-with-overlay">
  <div class="cover-image-stack">
    <img src="${safeBg}" alt="" class="cover-image" />
    <div class="cover-dom-overlay">
      <div class="cover-dom-overlay-inner">
        <h1 class="cover-overlay-h1">${safeTitle}</h1>
        <p class="cover-overlay-sub">${safeSubtitle}</p>
      </div>
    </div>
  </div>
</section>`;
  }

  const safeIssue = escapeHtml(cover.issue || "ISSUE · 战略情报局");
  const safeDate = escapeHtml(
    cover.date ||
      new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
  );
  const safeAbstract = cover.abstract ? escapeHtml(String(cover.abstract).slice(0, 220)) : "";

  // 5 套封面背景层（5 套主题色 → 杂志风径向渐变 + 主背景）
  const layers: Record<HtmlPdfStyle, string> = {
    "spring-mint": `
      radial-gradient(70% 50% at 18% 18%, rgba(110,231,183,0.55) 0%, rgba(110,231,183,0) 70%),
      radial-gradient(60% 45% at 85% 25%, rgba(251,113,133,0.40) 0%, rgba(251,113,133,0) 70%),
      radial-gradient(80% 60% at 80% 90%, rgba(52,211,153,0.40) 0%, rgba(52,211,153,0) 75%),
      radial-gradient(60% 45% at 15% 95%, rgba(254,205,211,0.55) 0%, rgba(254,205,211,0) 75%),
      linear-gradient(180deg, #ECFDF5 0%, #FCE7F3 60%, #FFE4E6 100%)`,
    "neon-tech": `
      radial-gradient(70% 50% at 100% 0%, rgba(6,182,212,0.45) 0%, rgba(6,182,212,0) 60%),
      radial-gradient(80% 60% at -10% 110%, rgba(168,85,247,0.40) 0%, rgba(168,85,247,0) 65%),
      radial-gradient(40% 30% at 30% 30%, rgba(244,114,182,0.32) 0%, rgba(244,114,182,0) 75%),
      radial-gradient(50% 35% at 70% 60%, rgba(6,182,212,0.22) 0%, rgba(6,182,212,0) 70%),
      linear-gradient(155deg, #0F0728 0%, #1E1B4B 50%, #312E81 100%)`,
    "sunset-coral": `
      radial-gradient(70% 50% at 18% 22%, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0) 70%),
      radial-gradient(60% 45% at 85% 30%, rgba(244,114,182,0.45) 0%, rgba(244,114,182,0) 70%),
      radial-gradient(80% 60% at 70% 95%, rgba(139,92,246,0.45) 0%, rgba(139,92,246,0) 75%),
      radial-gradient(60% 45% at 18% 95%, rgba(252,211,77,0.40) 0%, rgba(252,211,77,0) 75%),
      linear-gradient(160deg, #FFEDD5 0%, #FBCFE8 50%, #C4B5FD 100%)`,
    "ocean-fresh": `
      radial-gradient(70% 50% at 100% 0%, rgba(250,204,21,0.30) 0%, rgba(250,204,21,0) 60%),
      radial-gradient(80% 60% at -10% 110%, rgba(37,99,235,0.45) 0%, rgba(37,99,235,0) 65%),
      radial-gradient(35% 28% at 12% 25%, rgba(56,189,248,0.40) 0%, rgba(56,189,248,0) 75%),
      linear-gradient(180deg, #DBEAFE 0%, #93C5FD 60%, #2563EB 100%)`,
    "business-bright": `
      radial-gradient(70% 50% at 100% 0%, rgba(31,58,95,0.18) 0%, rgba(31,58,95,0) 60%),
      radial-gradient(80% 60% at -10% 110%, rgba(31,58,95,0.22) 0%, rgba(31,58,95,0) 65%),
      radial-gradient(35% 28% at 12% 25%, rgba(201,168,88,0.30) 0%, rgba(201,168,88,0) 75%),
      linear-gradient(180deg, #F8FAFC 0%, #EAF0F6 100%)`,
  };

  const isDark = style === "neon-tech" || style === "ocean-fresh";

  const lightStyles = !isDark
    ? `
      .cover-pill { background: rgba(255,255,255,0.65); border: 1px solid rgba(15,23,42,0.10); color: ${palette.textMain}; }
      .cover-issue { color: ${palette.textMuted}; }
      .cover-eyebrow { color: ${palette.primary}; }
      .cover-mega { color: ${palette.primary}; text-shadow: 0 6px 28px rgba(255,255,255,0.5); }
      .cover-title { color: ${palette.textMain}; text-shadow: none; }
      .cover-abstract { color: ${palette.textMain}; border-left: 2px solid ${palette.accent}; }
      .cover-bottom { color: ${palette.textMuted}; border-top: 1px solid ${palette.rule}; }
      .cover-conf { color: ${palette.confidential}; font-weight: 800; }
    `
    : "";

  const eyebrow =
    style === "spring-mint" ? "FRESH STRATEGIC INSIGHT"
    : style === "neon-tech" ? "FUTURE OPS · TECH BRIEF"
    : style === "sunset-coral" ? "CREATIVE STRATEGY"
    : style === "ocean-fresh" ? "OCEAN BUSINESS BRIEF"
    : "BUSINESS PLAN";

  return `<section class="cover-page">
  <div class="cover-bg" style="background: ${layers[style]};"></div>
  <div class="cover-frame">
    <div class="cover-top">
      <div class="cover-pill">✓ 战略情报局 · INTELLIGENCE BUREAU</div>
      <div class="cover-issue">${safeIssue} · ${safeDate}</div>
    </div>
    <div class="cover-center">
      <div class="cover-eyebrow">${eyebrow}</div>
      <h1 class="cover-mega">${safeSubtitle}</h1>
      <h2 class="cover-title">${safeTitle}</h2>
      ${safeAbstract ? `<p class="cover-abstract">${safeAbstract}</p>` : ""}
    </div>
    <div class="cover-bottom">
      <span>MV STUDIO PRO · 战略情报局</span>
      <span class="cover-conf">CONFIDENTIAL · BOARDROOM ONLY</span>
    </div>
  </div>
  <style>${lightStyles}</style>
</section>`;
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────

export function generateInteractiveHtml(markdownContent: string, opts?: HtmlReportOpts): string {
  const style: HtmlPdfStyle = opts?.style || "spring-mint";
  const palette = buildHtmlPalette(style);

  // 0. 用户决策（2026-05-01）：如果有封面，剥掉 markdown 开头的第一个 # H1，
  // 避免封面的 cover-title 跟正文 H1 视觉上重复同一行字。
  // 仅去掉**第一个**起始 H1，后续小节的 H1（如 # 一、个人亮点提取）保留。
  let mdRaw = markdownContent || "";
  if (opts?.cover) {
    mdRaw = mdRaw.replace(/^\s*#\s+[^\n]+\n+/, "");
  }

  // 1. 把 markdown 里的数值表格扫出来，替换成 .echart-mount 占位 div + 收集 option
  const { markdown: mdWithMounts, charts } = injectChartMountsIntoMarkdown(mdRaw, {
    theme: style as EChartsTheme,
  });

  // 2. marked → HTML（raw HTML 透传，与 PR #330 修复一致；GFM 默认开启）
  const htmlBody = enhanceTables(parseMarkdownToHtml(mdWithMounts));

  // 3. 封面 + 可選分鏡表（Cam4-1：圖內零字、標題 DOM 疊加）
  const reportTitleFallback = String(opts?.documentTitle || opts?.cover?.title || "战略情报报告").trim();
  const coverHtml = opts?.cover
    ? buildHtmlCover(palette, opts.cover, style)
    : "";
  const storyboardSheetHtml =
    opts?.storyboardSheet && String(opts.storyboardSheet.imageUrl || "").trim()
      ? buildHtmlStoryboardSheetSection(opts.storyboardSheet, reportTitleFallback)
      : "";
  const xhsDualNoteHtml =
    opts?.xhsDualNote && String(opts.xhsDualNote.imageUrl || "").trim()
      ? buildHtmlXhsNoteSection(opts.xhsDualNote, reportTitleFallback)
      : "";

  // 4. 内联 echarts.min.js（约 1MB），失败时降级 CDN（保证 HTML 至少能用）
  const { script: echartsScript } = readEchartsScript();
  const echartsScriptTag = echartsScript
    ? `<script>${echartsScript}</script>`
    : `<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>`;

  // 5. 拼前端初始化脚本：扫描所有 .echart-mount，把对应 option 套进去
  const chartOptionsJson = JSON.stringify(charts);
  const initScript = `
(function () {
  if (typeof window === 'undefined' || !window.echarts) return;
  var charts = ${chartOptionsJson};
  var byIndex = {};
  charts.forEach(function (c) { byIndex[c.index] = c; });
  var nodes = document.querySelectorAll('.echart-mount');
  nodes.forEach(function (el) {
    var id = el.id || '';
    var idx = parseInt(id.replace('echart-', ''), 10);
    var entry = byIndex[idx];
    if (!entry || !entry.option) return;
    try {
      var inst = window.echarts.init(el, null, { renderer: 'svg' });
      inst.setOption(entry.option);
      window.addEventListener('resize', function () { inst.resize(); });
    } catch (e) {
      el.innerHTML = '<div style="padding:20px;color:#94a3b8;font-size:12px;">图表初始化失败：' + (e && e.message ? e.message : '未知错误') + '</div>';
    }
  });
})();
`;

  const docTitle = escapeHtml(opts?.documentTitle || opts?.cover?.title || "战略情报研报");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${docTitle}</title>
<style>
  :root {
    --bg-page: ${palette.bg};
    --bg-elev: ${palette.bgElev};
    --text-main: ${palette.textMain};
    --text-muted: ${palette.textMuted};
    --primary: ${palette.primary};
    --primary-soft: ${palette.primarySoft};
    --accent: ${palette.accent};
    --navy: ${palette.navy};
    --rule: ${palette.rule};
    --row-alt: ${palette.rowAlt};
    --th-bg: ${palette.tableHeadBg};
    --th-text: ${palette.tableHeadText};
    --cover-bg: ${palette.coverBg};
    --cover-gold: ${palette.coverGold};
    --h2-bg: ${palette.h2Bg};
    --h2-text: ${palette.h2Text};
    --section-stripe: ${palette.sectionStripe};
    --star: ${palette.starColor};
    --confidential: ${palette.confidential};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC",
      "Microsoft YaHei", system-ui, -apple-system, sans-serif;
    background: var(--bg-page);
    color: var(--text-main);
    line-height: 1.78;
    font-size: 15px;
    letter-spacing: 0.005em;
  }
  .doc-shell {
    max-width: 980px;
    margin: 0 auto;
    padding: 24px 28px 64px;
  }
  /* ── 封面 ── */
  .cover-page { position: relative; width: 100%; min-height: 70vh; color: #fff; overflow: hidden; border-radius: 16px; margin-bottom: 32px; }
  .cover-bg { position: absolute; inset: 0; background-color: var(--cover-bg); filter: saturate(1.05); }
  /* 纯图封面（cover-image-only）：用 <img> 而非 background，object-fit:contain 保持 9:16
     完整显示，避免 background:cover 切掉上下杂志元素。HTML 视图最多占满一屏；PDF 印刷
     由 @media print 控制成 A4 单页。 */
  .cover-page.cover-image-only { display: flex; justify-content: center; align-items: center; min-height: auto; padding: 0; background: #0a0a0a; }
  .cover-page.cover-image-only .cover-image { display: block; width: auto; height: auto; max-width: 100%; max-height: 95vh; object-fit: contain; }
  /* 有 URL 封面图时：底图纯视觉 + DOM 叠字（与 gpt-image-2 零画内文字策略一致） */
  .cover-page.cover-image-with-overlay { display: flex; justify-content: center; align-items: center; min-height: auto; padding: 0; background: #0a0a0a; }
  .cover-image-stack { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
  .cover-page.cover-image-with-overlay .cover-image { display: block; width: auto; height: auto; max-width: 100%; max-height: 95vh; object-fit: contain; }
  .cover-dom-overlay { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; justify-content: flex-start; pointer-events: none;
    padding: clamp(28px, 7vw, 64px) clamp(22px, 5vw, 52px);
    background: linear-gradient(180deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.12) 42%, rgba(0,0,0,0.68) 100%); }
  .cover-dom-overlay-inner { max-width: 92%; }
  .cover-overlay-h1 { margin: 0 0 14px; font-family: "Noto Serif CJK SC", Georgia, serif; font-size: clamp(26px, 3.8vw, 46px); font-weight: 900; line-height: 1.12; color: #fff;
    text-shadow: 0 4px 28px rgba(0,0,0,0.55); letter-spacing: 0.02em; }
  .cover-overlay-sub { margin: 0; font-size: clamp(13px, 1.9vw, 20px); font-weight: 700; color: var(--primary); letter-spacing: 0.06em; line-height: 1.45;
    text-shadow: 0 2px 16px rgba(0,0,0,0.45); }
  .cover-frame { position: relative; z-index: 2; display: flex; flex-direction: column; justify-content: space-between; min-height: 70vh; padding: 48px 44px; }
  .cover-top { display: flex; justify-content: space-between; align-items: center; }
  .cover-pill { background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.22); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.10em; }
  .cover-issue { color: rgba(255,255,255,0.78); font-size: 11px; letter-spacing: 0.18em; font-weight: 600; }
  .cover-eyebrow { color: var(--cover-gold); letter-spacing: 0.36em; font-size: 12px; font-weight: 700; margin-bottom: 18px; }
  .cover-mega { font-family: "Noto Serif CJK SC", Georgia, serif; font-size: 44px; font-weight: 900; line-height: 1.04; letter-spacing: 0.04em; color: var(--cover-gold); margin: 0 0 22px; text-transform: uppercase; text-shadow: 0 8px 36px rgba(0,0,0,0.45); }
  .cover-title { font-family: "Noto Serif CJK SC", Georgia, serif; font-size: 26px; font-weight: 800; line-height: 1.35; color: #fff; margin: 0 0 18px; text-shadow: 0 6px 30px rgba(0,0,0,0.6); }
  .cover-abstract { color: rgba(255,255,255,0.88); font-size: 13px; line-height: 1.85; max-width: 620px; border-left: 2px solid var(--cover-gold); padding-left: 14px; margin: 0; }
  .cover-bottom { display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,0.78); font-size: 10px; font-weight: 700; letter-spacing: 0.16em; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.18); margin-top: 24px; }
  .cover-conf { color: #FFE6BE; letter-spacing: 0.20em; }
  /* ── 标题 ── */
  h1, h2, h3, h4 { font-family: "Noto Serif CJK SC", Georgia, serif; letter-spacing: 0.025em; line-height: 1.45; }
  h1 { font-size: 26px; font-weight: 900; color: var(--primary); padding: 22px 24px 18px; margin: 28px 0 22px; background: linear-gradient(90deg, ${palette.primary}18 0%, ${palette.accent}10 60%, transparent 100%), var(--bg-elev); border-left: 6px solid var(--primary); border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); border-radius: 4px; }
  h2 { font-size: 20px; font-weight: 800; color: var(--h2-text); background: var(--h2-bg); padding: 9px 18px; margin: 36px 0 18px; border-left: 4px solid var(--star); border-bottom: 2px solid var(--section-stripe); border-radius: 2px; }
  h2::before { content: "★ "; color: var(--star); font-size: 16px; font-weight: 900; margin-right: 6px; }
  h3 { font-size: 17px; font-weight: 800; color: var(--primary); margin: 24px 0 12px; padding-left: 12px; border-left: 3px solid var(--accent); }
  h4 { font-size: 15px; font-weight: 700; color: var(--accent); margin: 18px 0 8px; }
  p { margin: 10px 0; color: var(--text-main); }
  strong { color: var(--accent); font-weight: 800; }
  em { color: var(--text-muted); font-style: italic; }
  a { color: var(--primary); text-decoration: underline; }
  hr { border: none; border-top: 1px solid var(--rule); margin: 26px 0; }
  ul, ol { padding-left: 22px; margin: 10px 0; }
  li { margin: 4px 0; line-height: 1.78; }
  li::marker { color: var(--primary); font-weight: 700; }
  /* ── 表格 ── */
  table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
  thead th { background: var(--th-bg); color: var(--th-text); padding: 11px 13px; text-align: left; font-weight: 700; font-size: 12px; letter-spacing: 0.05em; border-right: 1px solid rgba(255,255,255,0.10); white-space: nowrap; }
  thead th:last-child { border-right: none; }
  /* 表头内行内 Markdown（strong/code）勿套正文 accent 色，一律跟随表头白字，否则多主题下不可读 */
  thead th strong,
  thead th em { color: var(--th-text); font-weight: 800; }
  thead th code { color: var(--th-text); background: rgba(255,255,255,0.22); }
  tbody td { padding: 10px 13px; border-bottom: 1px solid var(--rule); vertical-align: top; color: var(--text-main); }
  tbody tr:nth-child(even) td { background-color: var(--row-alt); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.num.pos { color: #15803D; font-weight: 700; }
  td.num.neg { color: #B91C1C; font-weight: 700; }
  blockquote { border-left: 4px solid var(--primary); background: ${palette.primary}10; padding: 13px 20px; margin: 18px 0; color: var(--accent); border-radius: 0 8px 8px 0; }
  code { background: ${palette.accent}12; padding: 1px 6px; border-radius: 3px; font-family: "JetBrains Mono", Menlo, monospace; font-size: 12px; color: var(--accent); }
  pre { background: ${palette.bgElev}; color: ${palette.primary}; padding: 14px 16px; border-radius: 6px; border-left: 3px solid var(--primary); overflow-x: auto; font-size: 12px; }
  pre code { background: transparent; padding: 0; color: inherit; }
  img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  /* ── 场景图 figure ── */
  figure.scene-figure { margin: 22px auto 16px; padding: 0; max-width: 100%; text-align: center; }
  figure.scene-figure img { display: block; margin: 0 auto; max-width: 100%; max-height: 540px; object-fit: cover; border-radius: 10px; border: 1px solid var(--rule); box-shadow: 0 6px 24px rgba(0,0,0,0.10); }
  figure.scene-figure figcaption { margin-top: 10px; font-size: 12px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em; line-height: 1.5; font-style: italic; max-width: 90%; margin-left: auto; margin-right: auto; }
  /* ── 報告內橫版分鏡表（純圖 + 疊加標題，與 gpt-image-2 零畫內文字一致） ── */
  .report-storyboard-sheet { margin: 28px 0 36px; }
  .storyboard-container { position: relative; width: 100%; border-radius: 12px; overflow: hidden; page-break-inside: avoid; border: 1px solid var(--rule); }
  .storyboard-canvas-img { width: 100%; display: block; aspect-ratio: 16 / 9; object-fit: cover; }
  .storyboard-dom-overlay { position: absolute; top: 0; left: 0; width: 100%; padding: 20px; box-sizing: border-box;
    background: linear-gradient(to bottom, rgba(0,0,0,0.82), rgba(0,0,0,0.35) 45%, transparent); color: #fff; pointer-events: none; z-index: 2; }
  .storyboard-overlay-title { margin: 0; font-size: 1.25rem; font-weight: 800; line-height: 1.35; letter-spacing: 0.04em;
    text-shadow: 0 2px 6px rgba(0,0,0,0.55); font-family: "Noto Serif CJK SC", Georgia, serif; }
  /* ── 数据可视化 figure（echarts mount） ── */
  figure.chart-figure { margin: 22px auto 18px; padding: 14px 16px 12px; max-width: 100%; text-align: center; background: var(--bg-elev); border: 1px solid var(--rule); border-radius: 10px; }
  figure.chart-figure .echart-mount { width: 100% !important; min-height: 320px; }
  figure.chart-figure figcaption { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em; line-height: 1.5; }
  /* ── 工具栏（右上角，提示交互版 + 主题）── */
  .doc-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px; background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--rule); }
  .doc-toolbar .brand { font-size: 13px; font-weight: 800; color: var(--primary); letter-spacing: 0.04em; }
  .doc-toolbar .badge { font-size: 11px; font-weight: 700; color: var(--accent); padding: 4px 10px; border-radius: 99px; background: ${palette.accent}1f; letter-spacing: 0.05em; }
  @media (max-width: 720px) {
    .doc-shell { padding: 16px 14px 48px; }
    .cover-mega { font-size: 32px; }
    .cover-title { font-size: 20px; }
  }
</style>
${echartsScriptTag}
</head>
<body data-theme="${style}">
  <div class="doc-toolbar">
    <span class="brand">MV STUDIO PRO · 战略情报局 · 交互版报告</span>
    <span class="badge">HTML INTERACTIVE</span>
  </div>
  <div class="doc-shell">
    ${coverHtml}
    ${storyboardSheetHtml}
    ${xhsDualNoteHtml}
    <article class="report-body">
      ${htmlBody}
    </article>
    <footer style="margin-top:48px;padding-top:20px;border-top:1px solid var(--rule);font-size:11px;color:var(--text-muted);letter-spacing:0.06em;text-align:center;">
      © ${new Date().getFullYear()} · MV STUDIO PRO · CONFIDENTIAL · BOARDROOM ONLY
    </footer>
  </div>
  <script>${initScript}</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 透传给路由层使用的 chart 数量计数（仅供 logging / 测试） ─────────────────
export function countDerivedCharts(markdownContent: string): number {
  const { charts } = injectChartMountsIntoMarkdown(markdownContent || "");
  return charts.length;
}

// 重新导出类型供下游使用
export type { ExtractedChart };
