/**
 * 战略情报局 · 智库报告 v3 模板（B 端高端商务风）
 *
 * 与 marked 组合后由 Puppeteer 在容器内 printBackground 出 PDF。
 * 不依赖外网字体 CDN（容器内已装 fonts-noto-cjk + fonts-noto-color-emoji），
 * 避免 networkidle 卡死。
 *
 * 核心修复（v2 → v3）：
 *   1. 四套可选 style：quiet-luxury（静奢白）/ watercolor（水彩薄雾）/ business-bright（商务亮）/ business-dark（商务夜）
 *   2. 修 H1/H2/H3 视觉差异（H2 「★ 胶囊条 + 主色渐变 + 金线」）
 *   3. 修表格列宽崩坏（th nowrap + min-width，td 内 numeric 列右对齐）
 *   4. 修跨页表头丢失（thead display: table-header-group + tr page-break-inside: avoid）
 *   5. 修 emoji 方块（容器装 fonts-noto-color-emoji + 字体栈优先级）
 *   6. 修「9.5/10」类比例排版（service 层调用 sanitizeMarkdown 预处理）
 *   7. 不确定性 / 高中低 / 增减幅度自动彩色徽章
 *   8. 可选封面页（cover.imageUrl 注入 → A4 全屏黑底大图刊物风首页）
 */

import { marked } from "marked";

marked.setOptions({ gfm: true });

export type PdfStyle =
  | "quiet-luxury"      // ① 静奢白（默认）：纯白 + 暖琥珀金 H1 + 深炭表头
  | "watercolor"        // ② 水彩薄雾：浅冷蓝 → 暖橘粉，远山轮廓
  | "business-bright"   // ③ 高端商务亮：白底 + 海军蓝 + 香槟金 + 大字英文 outline
  | "business-dark";    // ④ 黑色商务深：封面深炭夜景 + 橙金，正文仍浅底（审美红线）

export type PdfCover = {
  /** 封面背景大图 URL（建议 3:4 直版，nanoImage 已 generate） */
  imageUrl?: string;
  /** 封面主标题（中文，例：亚洲银发经济：抗衰保健品跨境破局战略） */
  title?: string;
  /** 英文副标题（全大写，例：EXCLUSIVE INSIGHTS · CROSS-BORDER GROWTH IN ASIA） */
  subtitle?: string;
  /** 期号（例：ISSUE 45） */
  issue?: string;
  /** 出品日期（例：2026 年 4 月 29 日） */
  date?: string;
  /** 摘要（封底的一句话引导） */
  abstract?: string;
};

function parseMarkdownToHtml(markdownContent: string): string {
  const raw = String(markdownContent || "").trim();
  if (!raw) return "<p>（无正文）</p>";
  return marked.parse(raw, { async: false }) as string;
}

/** 把表头第一个单元格 / 数字列做语义增强，便于 CSS 锁列宽与右对齐 */
function enhanceTables(html: string): string {
  // td/th 内只含数字 + 单位 时，加 .num 类（右对齐 + tabular-nums）
  // 简单规则：纯数字（含 % / 倍 / 元 / 万 / 亿 / 个 / 天 / 分 等中文单位 / + - .）
  return html.replace(
    /<(td|th)>([\s\S]*?)<\/\1>/g,
    (m, tag: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const isNumeric =
        text.length > 0 &&
        text.length < 24 &&
        /^[\d.,+\-%／/×倍分元万千亿点位天月年个日小时秒级]+$/.test(text.replace(/\s/g, ""));
      const isPctChange = /^[+\-]\s*\d+(\.\d+)?\s*%$/.test(text);
      const isHighLow = /^(高|中高|中|中低|低|H|M|L)$/i.test(text);
      const cls: string[] = [];
      if (isNumeric || isPctChange) cls.push("num");
      if (isPctChange) {
        cls.push(text.startsWith("-") ? "neg" : "pos");
      }
      if (isHighLow) {
        cls.push(
          text === "高" || /^h$/i.test(text)
            ? "lvl-h"
            : text === "低" || /^l$/i.test(text)
              ? "lvl-l"
              : "lvl-m",
        );
      }
      return `<${tag}${cls.length ? ` class="${cls.join(" ")}"` : ""}>${inner}</${tag}>`;
    },
  );
}

/**
 * 4 套调色板（统一约束）：
 *   - 正文页一律白底/极浅底 + 深字（深底配深字 = 不可读，业内大忌）
 *   - 深色调（business-dark）只在封面 / H1 章首横幅 / 表头使用，正文回浅底
 *   - 表头深底必配浅字，浅底必配深字，绝不交叉
 */
function buildPalette(style: PdfStyle): Record<string, string> {
  // ── ② watercolor · 水彩薄雾（用户参考图：淡冷蓝 → 暖橘粉远山）
  if (style === "watercolor") {
    return {
      bg: "#FBFCFD",                   // 极淡冷白
      bgElev: "#FFFFFF",
      textMain: "#1F2A2E",
      textMuted: "#6E7A82",
      primary: "#7A8C92",              // 雾蓝灰（H1 主色）
      primarySoft: "#A9B7BE",
      accent: "#C58C6E",               // 暖橘粉赭石（点缀）
      navy: "#2B3940",
      rule: "#E4E9EC",
      rowAlt: "#F4F6F8",
      tableHeadBg: "#EAF0F4",          // 浅冷蓝雾
      tableHeadText: "#2B3940",        // 深字（浅底深字 ✅）
      coverBg: "#F2F8F8",              // 水彩底（浅）
      coverGold: "#C58C6E",            // 暖赭石点缀
      h2Bg: "linear-gradient(90deg, #EAF0F4 0%, #F8EDE6 100%)", // 冷→暖薄雾
      h2Text: "#2B3940",
      sectionStripe: "#C58C6E",
      starColor: "#C58C6E",
      confidential: "#A04C4C",
    };
  }

  // ── ③ business-bright · 高端商务亮系（用户参考：白底 + 海军蓝 + 香槟金）
  if (style === "business-bright") {
    return {
      bg: "#F8FAFC",                   // 极冷白
      bgElev: "#FFFFFF",
      textMain: "#0F1B2D",             // 深海军黑
      textMuted: "#55657A",
      primary: "#1F3A5F",              // 海军蓝（H1）
      primarySoft: "#3A5A85",
      accent: "#C9A858",               // 香槟金
      navy: "#0F1B2D",
      rule: "#D8E1EC",
      rowAlt: "#EDF2F7",
      tableHeadBg: "#1F3A5F",          // 深海军（深底必配浅字 ✅）
      tableHeadText: "#FFFFFF",
      coverBg: "#EAF0F6",              // 浅冷蓝白封面
      coverGold: "#C9A858",
      h2Bg: "linear-gradient(90deg, #1F3A5F 0%, #2D4A6F 100%)",
      h2Text: "#FFFFFF",               // 深底白字 ✅
      sectionStripe: "#C9A858",
      starColor: "#C9A858",
      confidential: "#A52A2A",
    };
  }

  // ── ④ business-dark · 黑色商务深系（封面深炭 + 橙金 · 正文强制浅底）
  if (style === "business-dark") {
    return {
      // ⚠️ 正文页 bg 仍用极浅米：审美红线 — 长文档不能深底深字
      bg: "#FAFAF7",
      bgElev: "#FFFFFF",
      textMain: "#1A1A1A",
      textMuted: "#4A4A4A",
      primary: "#2A2D33",              // 深炭（H1 文字色）
      primarySoft: "#4A4D55",
      accent: "#E89549",               // 橙金（重点强调）
      navy: "#1A1D22",
      rule: "#D9D5C9",
      rowAlt: "#F2EEE5",
      tableHeadBg: "#2A2D33",          // 深炭表头（深底必配浅字 ✅）
      tableHeadText: "#FFD9A8",        // 暖米黄
      coverBg: "#1A1D22",              // 封面深炭夜景
      coverGold: "#E89549",            // 橙金大字
      h2Bg: "linear-gradient(90deg, #2A2D33 0%, #1A1D22 100%)", // H2 深炭横幅
      h2Text: "#E89549",               // 橙金（深底亮字 ✅）
      sectionStripe: "#E89549",
      starColor: "#E89549",
      confidential: "#E89549",
    };
  }

  // ── ① quiet-luxury · 静奢白（默认）：纯白 + 古铜金标题 + 深炭正文（标题/正文绝不同色）
  return {
    bg: "#FFFFFF",
    bgElev: "#FAFAF8",
    textMain: "#1A1A1A",               // 正文：深炭
    textMuted: "#6B7280",
    primary: "#8B6F3D",                // H1：暖琥珀金（与正文深炭强对比）
    primarySoft: "#A88A5C",
    accent: "#B8A073",                 // H3 / 强调：浅古铜金
    navy: "#2D2D2D",
    rule: "#E8E4DA",
    rowAlt: "#FAF8F2",
    tableHeadBg: "#2D2D2D",            // 深炭表头（深底必配浅字 ✅）
    tableHeadText: "#F5E9C8",          // 浅米黄
    coverBg: "#F5F0E8",
    coverGold: "#8B6F3D",
    h2Bg: "linear-gradient(90deg, #2D2D2D 0%, #1A1A1A 100%)", // H2 深炭横幅
    h2Text: "#F5E9C8",                 // 深底浅字 ✅
    sectionStripe: "#B8A073",
    starColor: "#B8A073",
    confidential: "#A04C4C",
  };
}

function buildCoverPage(palette: Record<string, string>, cover: PdfCover, style: PdfStyle): string {
  const safeBg = String(cover.imageUrl || "").replace(/"/g, "&quot;");
  const safeTitle = String(cover.title || "战略情报报告").replace(/</g, "&lt;");
  const safeSubtitle = String(
    cover.subtitle || "EXCLUSIVE STRATEGIC INTELLIGENCE",
  ).replace(/</g, "&lt;");
  const safeIssue = String(cover.issue || "ISSUE · 战略情报局").replace(/</g, "&lt;");
  const safeDate = String(
    cover.date ||
      new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
  ).replace(/</g, "&lt;");
  const safeAbstract = cover.abstract
    ? String(cover.abstract).slice(0, 110).replace(/</g, "&lt;")
    : "";

  // ── 4 套封面背景层 ──────────────────────────────────────────────
  // ① quiet-luxury · 静奢白：纯白 + 古铜金细线圆环（极简留白）
  const quietLuxuryLayer = `
    radial-gradient(55% 40% at 80% 12%, rgba(184,160,115,0.10) 0%, rgba(184,160,115,0) 70%),
    radial-gradient(45% 35% at 18% 88%, rgba(184,160,115,0.08) 0%, rgba(184,160,115,0) 72%),
    linear-gradient(180deg, #FFFFFF 0%, #FAFAF8 100%)
  `;

  // ② watercolor · 水彩薄雾：浅冷蓝雾 + 暖橘粉雾气 + 远山轮廓
  const watercolorLayer = `
    radial-gradient(60% 45% at 75% 18%, rgba(196,225,235,0.72) 0%, rgba(196,225,235,0) 70%),
    radial-gradient(55% 40% at 25% 30%, rgba(225,238,238,0.65) 0%, rgba(225,238,238,0) 70%),
    radial-gradient(70% 50% at 30% 78%, rgba(244,206,180,0.68) 0%, rgba(244,206,180,0) 72%),
    radial-gradient(60% 50% at 70% 88%, rgba(214,182,180,0.65) 0%, rgba(214,182,180,0) 75%),
    radial-gradient(80% 35% at 50% 100%, rgba(180,170,168,0.55) 0%, rgba(180,170,168,0) 80%),
    linear-gradient(180deg, #F2F8F8 0%, #FBEFE5 65%, #E8DAD2 100%)
  `;

  // ③ business-bright · 高端商务亮：白底 + 海军蓝弧形 mask + 香槟金 hairline
  const businessBrightLayer = `
    radial-gradient(70% 50% at 100% 0%, rgba(31,58,95,0.10) 0%, rgba(31,58,95,0) 60%),
    radial-gradient(80% 60% at -10% 110%, rgba(31,58,95,0.14) 0%, rgba(31,58,95,0) 65%),
    radial-gradient(35% 28% at 12% 25%, rgba(201,168,88,0.18) 0%, rgba(201,168,88,0) 75%),
    linear-gradient(180deg, #F8FAFC 0%, #EAF0F6 100%)
  `;

  // ④ business-dark · 黑色商务深：深炭夜景渐变 + 橙金光晕（仅封面深色）
  const businessDarkLayer = `
    radial-gradient(80% 60% at 100% 0%, rgba(232,149,73,0.18) 0%, rgba(232,149,73,0) 60%),
    radial-gradient(70% 55% at 0% 100%, rgba(232,149,73,0.10) 0%, rgba(232,149,73,0) 65%),
    radial-gradient(50% 40% at 50% 50%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%),
    linear-gradient(155deg, #1A1D22 0%, #2A2D33 60%, #1A1D22 100%)
  `;

  let bgLayer: string;
  let isLightCover = false; // 浅底封面要换浅底专用文字配色（避免白字看不见）

  if (safeBg) {
    // 用户上传了封面图，统一加深色 overlay 让标题清晰（business-bright/quiet-luxury 例外用浅 overlay）
    const overlayMode = style === "business-dark"
      ? "rgba(0,0,0,0.55)"
      : (style === "business-bright" || style === "quiet-luxury")
        ? "rgba(0,0,0,0.35)"
        : "rgba(0,0,0,0.45)";
    bgLayer = `linear-gradient(180deg, ${overlayMode} 0%, rgba(0,0,0,0.10) 38%, ${overlayMode} 100%), url("${safeBg}") center/cover no-repeat`;
  } else if (style === "watercolor") {
    bgLayer = watercolorLayer;
    isLightCover = true;
  } else if (style === "business-bright") {
    bgLayer = businessBrightLayer;
    isLightCover = true;
  } else if (style === "business-dark") {
    bgLayer = businessDarkLayer;
    isLightCover = false;
  } else {
    // quiet-luxury 默认
    bgLayer = quietLuxuryLayer;
    isLightCover = true;
  }

  const coverTextClass = isLightCover ? "cover-frame cover-frame-light" : "cover-frame";

  // 不同风格用不同的 eyebrow / 装饰文案（让封面有差异化）
  const eyebrow = style === "business-bright"
    ? "BUSINESS PLAN"
    : style === "business-dark"
      ? "EXECUTIVE BRIEF"
      : style === "watercolor"
        ? "STRATEGIC ATELIER"
        : "GLOBAL STRATEGY"; // quiet-luxury

  return `
  <section class="cover-page cover-${style}">
    <div class="cover-bg" style="background: ${bgLayer};"></div>
    <div class="${coverTextClass}">
      <div class="cover-top">
        <div class="cover-pill">✓ 战略情报局 · INTELLIGENCE BUREAU</div>
        <div class="cover-issue">${safeIssue} · ${safeDate}</div>
      </div>
      <div class="cover-center">
        <div class="cover-eyebrow">${eyebrow}</div>
        <h1 class="cover-mega">${safeSubtitle}</h1>
        <h2 class="cover-title">${safeTitle}</h2>
        ${
          safeAbstract
            ? `<p class="cover-abstract">${safeAbstract}</p>`
            : ""
        }
      </div>
      <div class="cover-bottom">
        <span>MV STUDIO PRO · 战略情报局</span>
        <span class="cover-conf">CONFIDENTIAL · BOARDROOM ONLY</span>
      </div>
    </div>
  </section>
  <div class="page-break"></div>`;
}

export function generateHtmlTemplate(
  markdownContent: string,
  opts?: { style?: PdfStyle; cover?: PdfCover },
): string {
  const style: PdfStyle = (opts?.style as PdfStyle) || "quiet-luxury";
  const palette = buildPalette(style);
  const htmlBody = enhanceTables(parseMarkdownToHtml(markdownContent));
  const coverHtml = opts?.cover ? buildCoverPage(palette, opts.cover, style) : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>战略情报局 · 智库报告</title>
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
      font-family: "Noto Sans CJK SC", "Noto Sans CJK TC", "Source Han Sans SC",
        "PingFang SC", "Microsoft YaHei", "Noto Color Emoji", system-ui,
        -apple-system, "Helvetica Neue", sans-serif;
      background-color: var(--bg-page);
      color: var(--text-main);
      line-height: 1.78;
      padding: 16px 14px 28px;
      font-size: 13.5px;
      letter-spacing: 0.005em;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ────────────────── 封面页 ────────────────── */
    .cover-page {
      position: relative;
      width: 100%;
      min-height: 1062px; /* A4 @ 96dpi 高 ~ 1122px，预留 margin */
      color: #fff;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .cover-bg {
      position: absolute;
      inset: 0;
      background-color: var(--cover-bg);
      filter: saturate(1.05);
    }
    .cover-frame {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 1062px;
      padding: 60px 56px;
    }
    .cover-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: "Noto Sans CJK SC", "Helvetica Neue", sans-serif;
    }
    .cover-pill {
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.20);
      color: #fff;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.10em;
    }
    .cover-issue {
      color: rgba(255, 255, 255, 0.78);
      font-size: 11px;
      letter-spacing: 0.18em;
      font-weight: 600;
    }
    .cover-center {
      max-width: 86%;
    }
    .cover-eyebrow {
      color: var(--cover-gold);
      letter-spacing: 0.36em;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 18px;
    }
    .cover-mega {
      font-family: "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif;
      font-size: 56px;
      font-weight: 900;
      line-height: 1.02;
      letter-spacing: 0.04em;
      color: var(--cover-gold);
      margin: 0 0 28px;
      text-transform: uppercase;
      text-shadow: 0 8px 36px rgba(0,0,0,0.45);
    }
    .cover-title {
      font-family: "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif;
      font-size: 30px;
      font-weight: 800;
      line-height: 1.32;
      color: #FFFFFF;
      margin: 0 0 22px;
      text-shadow: 0 6px 30px rgba(0,0,0,0.65);
      max-width: 720px;
    }
    .cover-abstract {
      color: rgba(255, 255, 255, 0.85);
      font-size: 13px;
      line-height: 1.85;
      max-width: 620px;
      border-left: 2px solid var(--cover-gold);
      padding-left: 14px;
      margin: 0;
    }
    .cover-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: rgba(255, 255, 255, 0.78);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.16em;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
    }
    .cover-conf {
      color: #FFE6BE;
      letter-spacing: 0.20em;
    }
    /* ── 静奢水彩封面专用：浅底用深字 ── */
    .cover-frame-light .cover-pill {
      background: rgba(255,255,255,0.55);
      border: 1px solid rgba(63,81,65,0.25);
      color: #2C3935;
    }
    .cover-frame-light .cover-issue {
      color: rgba(44,57,53,0.78);
    }
    .cover-frame-light .cover-eyebrow {
      color: #6B7E62;
    }
    .cover-frame-light .cover-mega {
      color: #2C3935;
      text-shadow: 0 6px 28px rgba(255,255,255,0.65);
    }
    .cover-frame-light .cover-title {
      color: #1F2A2E;
      text-shadow: none;
    }
    .cover-frame-light .cover-abstract {
      color: #3F4945;
      border-left: 2px solid #A89968;
    }
    .cover-frame-light .cover-bottom {
      color: rgba(44,57,53,0.78);
      border-top: 1px solid rgba(63,81,65,0.20);
    }
    .cover-frame-light .cover-conf {
      color: #A51C30; /* 红衬底：让 CONFIDENTIAL 在浅底上醒目 */
      letter-spacing: 0.20em;
      font-weight: 800;
    }
    .page-break {
      page-break-after: always;
      break-after: page;
      height: 0;
      overflow: hidden;
    }

    /* ────────────────── 极低权重斜对角水印 ────────────────── */
    .wm {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 96px;
      font-weight: 800;
      color: rgba(31, 42, 68, 0.045);
      letter-spacing: 0.18em;
      z-index: 0;
      pointer-events: none;
      white-space: nowrap;
      user-select: none;
    }
    .content { position: relative; z-index: 1; }

    /* ────────────────── 标题（视觉差异化）────────────────── */
    h1, h2, h3, h4 {
      font-family: "Noto Serif CJK SC", "Noto Serif CJK TC",
        "Source Han Serif SC", Georgia, serif;
      letter-spacing: 0.025em;
      line-height: 1.45;
    }
    /* 章节大标题（一/二/三...）— 大字 + 主色（绝不与正文同色） */
    h1 {
      font-size: 28px;
      font-weight: 900;
      color: var(--primary);             /* H1 用主色，不再用 text-main 避免和正文同色 */
      text-align: left;
      padding: 30px 30px 26px 32px;
      margin: 24px 0 28px;
      background:
        linear-gradient(90deg, ${palette.primary}18 0%, ${palette.accent}10 60%, transparent 100%),
        var(--bg-elev);
      border-left: 6px solid var(--primary);
      border-right: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
      letter-spacing: 0.02em;
      page-break-after: avoid;
      break-after: avoid;
    }
    /* 章节小节（▸ + 主色背景胶囊 + 金线下边） */
    h2 {
      font-size: 19px;
      font-weight: 800;
      color: var(--h2-text);
      background: var(--h2-bg);
      padding: 9px 18px 9px 16px;
      margin: 36px 0 18px;
      border-left: 4px solid var(--star);
      border-bottom: 2px solid var(--section-stripe);
      border-radius: 2px;
      letter-spacing: 0.04em;
      page-break-after: avoid;
      break-after: avoid;
    }
    h2::before {
      content: "★ ";
      color: var(--star);
      font-size: 16px;
      font-weight: 900;
      margin-right: 6px;
    }
    h3 {
      font-size: 15.5px;
      font-weight: 800;
      color: var(--primary);             /* H3 用主色，不再与正文 textMain 同色 */
      margin: 24px 0 12px;
      padding-left: 12px;
      border-left: 3px solid var(--accent);
      page-break-after: avoid;
      break-after: avoid;
    }
    h4 {
      font-size: 14px;
      font-weight: 700;
      color: var(--accent);
      margin: 18px 0 8px;
    }

    p { margin: 10px 0; color: var(--text-main); }
    strong { color: var(--accent); font-weight: 800; }
    em { color: var(--text-muted); font-style: italic; }
    a { color: var(--primary); text-decoration: underline; }
    hr {
      border: none;
      border-top: 1px solid var(--rule);
      margin: 26px 0;
    }

    ul, ol { padding-left: 22px; margin: 10px 0; }
    li { margin: 4px 0; line-height: 1.78; }
    li::marker { color: var(--primary); font-weight: 700; }

    /* ────────────────── 表格 — 修 6 大 bug ────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 12.5px;
      page-break-inside: auto;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
      table-layout: auto;
    }
    /* 修跨页表头丢失 */
    thead { display: table-header-group; }
    /* 修单元格被截断 */
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead th {
      background: var(--th-bg);
      color: var(--th-text);
      padding: 11px 13px;
      text-align: left;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      border-bottom: 2px solid var(--primary);
      border-right: 1px solid rgba(255,255,255,0.08);
      /* 修列宽崩坏：表头不允许被竖切 */
      white-space: nowrap;
      min-width: 64px;
      vertical-align: middle;
    }
    thead th:last-child { border-right: none; }
    tbody td {
      padding: 10px 13px;
      border-bottom: 1px solid var(--rule);
      vertical-align: top;
      color: var(--text-main);
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    tbody tr:nth-child(even) td { background-color: var(--row-alt); }
    /* 数字列右对齐 + 等宽数字 */
    td.num, th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" on;
      white-space: nowrap;
    }
    /* +/- 百分比染色徽章 */
    td.num.pos { color: #167B3A; font-weight: 700; }
    td.num.neg { color: #B5391E; font-weight: 700; }
    /* 高/中/低 染色徽章 */
    td.lvl-h, td.lvl-m, td.lvl-l {
      text-align: center;
      font-weight: 800;
      letter-spacing: 0.08em;
    }
    td.lvl-h { color: #fff; background: #167B3A; border-radius: 4px; }
    td.lvl-m { color: #fff; background: #C9A14A; border-radius: 4px; }
    td.lvl-l { color: #fff; background: #B5391E; border-radius: 4px; }

    /* 关键警示 / 引用块（升级为「卡片」）*/
    blockquote {
      border-left: 4px solid var(--primary);
      background: ${palette.primary}10;
      padding: 13px 20px;
      margin: 18px 0;
      color: var(--accent);
      border-radius: 0 8px 8px 0;
      font-style: normal;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
      page-break-inside: avoid;
    }
    blockquote p { margin: 6px 0; }
    blockquote strong { color: var(--primary); }

    /* 行内 code */
    code {
      background: ${palette.accent}12;
      padding: 1px 6px;
      border-radius: 3px;
      font-family: "JetBrains Mono", "SF Mono", Menlo, ui-monospace, monospace;
      font-size: 12px;
      color: var(--accent);
    }
    pre {
      background: var(--cover-bg);
      color: var(--cover-gold);
      padding: 14px 16px;
      border-radius: 6px;
      border-left: 3px solid var(--primary);
      overflow-x: auto;
      font-size: 12px;
      page-break-inside: avoid;
    }
    pre code { background: transparent; padding: 0; color: inherit; }

    img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
      table { page-break-inside: auto; }
      tr, td, th { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  ${coverHtml}
  <div class="wm">CONFIDENTIAL · 战略情报局</div>
  <div class="content">
    ${htmlBody}
  </div>
</body>
</html>`;
}
