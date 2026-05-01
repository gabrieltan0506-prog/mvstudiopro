/**
 * 战略情报局 · 智库报告 v4 模板（5 套活泼系 + 商务亮）
 *
 * 与 marked 组合后由 Puppeteer 在容器内 printBackground 出 PDF。
 * 不依赖外网字体 CDN（容器内已装 fonts-noto-cjk + fonts-noto-color-emoji），
 * 避免 networkidle 卡死。
 *
 * v3 → v4：
 *   ▸ 砍掉焦糖系（quiet-luxury / watercolor / business-dark）— 用户反馈"老气"
 *   ▸ 5 套新风格：
 *       ① spring-mint    薄荷绿 + 樱桃粉（清新轻奢）
 *       ② neon-tech      电光青 + 霓虹紫（B 端科技潮）
 *       ③ sunset-coral   珊瑚橘 + 紫罗兰（创意品牌策划）
 *       ④ ocean-fresh    海蓝 + 柠檬黄（商务但不死板）
 *       ⑤ business-bright 海军蓝 + 香槟金（B 端正式挡板，保留）
 *   ▸ 审美红线：正文一律浅底深字；表头深底必配浅字（与之前一致）
 */

import { marked } from "marked";
import { injectChartSvgsIntoMarkdown, type EChartsTheme } from "./echartsServerRender";

marked.setOptions({ gfm: true });

export type PdfStyle =
  | "spring-mint"      // ① 薄荷绿 + 樱桃粉（清新轻奢）
  | "neon-tech"        // ② 电光青 + 霓虹紫（科技潮玩）
  | "sunset-coral"     // ③ 珊瑚橘 + 紫罗兰（创意策划）
  | "ocean-fresh"      // ④ 海蓝 + 柠檬黄（商务清爽）
  | "business-bright"; // ⑤ 海军蓝 + 香槟金（B 端正式）

export type PdfCover = {
  imageUrl?: string;
  title?: string;
  subtitle?: string;
  issue?: string;
  date?: string;
  abstract?: string;
};

function parseMarkdownToHtml(markdownContent: string, style: PdfStyle): string {
  const raw = String(markdownContent || "").trim();
  if (!raw) return "<p>（无正文）</p>";
  // ── 图表注入（PDF 路径专用）──────────────────────────────────────────────
  // 在线 ReportRenderer 通过 recharts 把数值表格自动衍生成柱状图/折线图/雷达图，
  // PDF 之前没有这一步 → 用户报"PDF 图表空白"。
  // 现在用服务端 ECharts SSR 把同样的可视化做成静态 SVG，注入到表格之后；
  // marked 默认透传 raw HTML（含 <svg>），puppeteer 拿到的 HTML 已经是画好的图，
  // 无需 waitForFunction 等异步运行时。
  let pre = raw;
  try {
    pre = injectChartSvgsIntoMarkdown(raw, { theme: style as EChartsTheme });
  } catch (e: any) {
    console.warn("[pdfTemplate] 图表 SSR 注入失败（已降级为不出图）：", e?.message);
    pre = raw;
  }
  return marked.parse(pre, { async: false }) as string;
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
      const isHighLow = /^(高|中高|中|中低|低|H|M|L)$/i.test(text);
      const cls: string[] = [];
      if (isNumeric || isPctChange) cls.push("num");
      if (isPctChange) cls.push(text.startsWith("-") ? "neg" : "pos");
      if (isHighLow) {
        cls.push(
          text === "高" || /^h$/i.test(text) ? "lvl-h"
            : text === "低" || /^l$/i.test(text) ? "lvl-l"
              : "lvl-m",
        );
      }
      return `<${tag}${cls.length ? ` class="${cls.join(" ")}"` : ""}>${inner}</${tag}>`;
    },
  );
}

/**
 * 5 套调色板（统一约束）：
 *   - 正文页一律白底/极浅底 + 深字
 *   - 深色调只在封面 / H1 章首横幅 / 表头使用，正文回浅底
 *   - 表头深底必配浅字，浅底必配深字，绝不交叉
 */
function buildPalette(style: PdfStyle): Record<string, string> {
  // ── ① spring-mint · 薄荷绿 + 樱桃粉（清新轻奢）
  if (style === "spring-mint") {
    return {
      bg: "#FFFFFF",
      bgElev: "#F0FDF4",
      textMain: "#0F172A",
      textMuted: "#64748B",
      primary: "#10B981",              // H1：薄荷翡翠
      primarySoft: "#34D399",
      accent: "#FB7185",               // 樱桃粉
      navy: "#064E3B",
      rule: "#D1FAE5",
      rowAlt: "#ECFDF5",
      tableHeadBg: "#10B981",          // 翡翠表头（深底配白字 ✅）
      tableHeadText: "#FFFFFF",
      coverBg: "#ECFDF5",
      coverGold: "#FB7185",            // 樱桃粉作为封面强调
      h2Bg: "linear-gradient(90deg, #10B981 0%, #34D399 60%, #6EE7B7 100%)",
      h2Text: "#FFFFFF",
      sectionStripe: "#FB7185",
      starColor: "#FB7185",
      confidential: "#E11D48",
    };
  }

  // ── ② neon-tech · 电光青 + 霓虹紫（科技潮玩）
  if (style === "neon-tech") {
    return {
      bg: "#FAFBFF",                   // 极淡冷白（不刺眼）
      bgElev: "#F5F3FF",
      textMain: "#1E1B4B",
      textMuted: "#6B7280",
      primary: "#7C3AED",              // 霓虹紫（H1）
      primarySoft: "#A855F7",
      accent: "#06B6D4",               // 电光青
      navy: "#1E1B4B",
      rule: "#E9D5FF",
      rowAlt: "#F5F3FF",
      tableHeadBg: "#5B21B6",          // 深紫表头（深底配白字 ✅）
      tableHeadText: "#E0F2FE",
      coverBg: "#1E1B4B",              // 封面深紫夜景
      coverGold: "#06B6D4",            // 电光青大字
      h2Bg: "linear-gradient(90deg, #7C3AED 0%, #A855F7 50%, #06B6D4 100%)",
      h2Text: "#FFFFFF",
      sectionStripe: "#06B6D4",
      starColor: "#06B6D4",
      confidential: "#F472B6",
    };
  }

  // ── ③ sunset-coral · 珊瑚橘 + 紫罗兰（创意策划）
  if (style === "sunset-coral") {
    return {
      bg: "#FFFAF5",                   // 奶油暖白
      bgElev: "#FFF7ED",
      textMain: "#3C1361",             // 深紫文（不用纯黑，更暖）
      textMuted: "#7C5C8B",
      primary: "#8B5CF6",              // 紫罗兰
      primarySoft: "#A78BFA",
      accent: "#FB923C",               // 珊瑚橘
      navy: "#3C1361",
      rule: "#FED7AA",
      rowAlt: "#FFF1E6",
      tableHeadBg: "#7C3AED",          // 紫罗兰表头（深底配白字 ✅）
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

  // ── ④ ocean-fresh · 海蓝 + 柠檬黄（商务清爽）
  if (style === "ocean-fresh") {
    return {
      bg: "#F8FAFF",
      bgElev: "#EFF6FF",
      textMain: "#0C1A3D",
      textMuted: "#475569",
      primary: "#2563EB",              // 海蓝（H1）
      primarySoft: "#3B82F6",
      accent: "#FACC15",                // 柠檬黄（强调）
      navy: "#0C1A3D",
      rule: "#DBEAFE",
      rowAlt: "#EFF6FF",
      tableHeadBg: "#2563EB",          // 海蓝表头（深底配白字 ✅）
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

  // ── ⑤ business-bright · 高端商务亮（B 端正式挡板）
  return {
    bg: "#F8FAFC",
    bgElev: "#FFFFFF",
    textMain: "#0F1B2D",
    textMuted: "#55657A",
    primary: "#1F3A5F",                // 海军蓝
    primarySoft: "#3A5A85",
    accent: "#C9A858",                 // 香槟金
    navy: "#0F1B2D",
    rule: "#D8E1EC",
    rowAlt: "#EDF2F7",
    tableHeadBg: "#1F3A5F",            // 深海军（深底配白字 ✅）
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

  // ── 5 套封面背景层 ──────────────────────────────────────────────
  // ① spring-mint：薄荷淡雾 + 樱桃粉光晕
  const springMintLayer = `
    radial-gradient(70% 50% at 18% 18%, rgba(110,231,183,0.55) 0%, rgba(110,231,183,0) 70%),
    radial-gradient(60% 45% at 85% 25%, rgba(251,113,133,0.40) 0%, rgba(251,113,133,0) 70%),
    radial-gradient(80% 60% at 80% 90%, rgba(52,211,153,0.40) 0%, rgba(52,211,153,0) 75%),
    radial-gradient(60% 45% at 15% 95%, rgba(254,205,211,0.55) 0%, rgba(254,205,211,0) 75%),
    linear-gradient(180deg, #ECFDF5 0%, #FCE7F3 60%, #FFE4E6 100%)
  `;

  // ② neon-tech：深紫夜景 + 电光青粒子 + 霓虹紫光晕
  const neonTechLayer = `
    radial-gradient(70% 50% at 100% 0%, rgba(6,182,212,0.45) 0%, rgba(6,182,212,0) 60%),
    radial-gradient(80% 60% at -10% 110%, rgba(168,85,247,0.40) 0%, rgba(168,85,247,0) 65%),
    radial-gradient(40% 30% at 30% 30%, rgba(244,114,182,0.32) 0%, rgba(244,114,182,0) 75%),
    radial-gradient(50% 35% at 70% 60%, rgba(6,182,212,0.22) 0%, rgba(6,182,212,0) 70%),
    linear-gradient(155deg, #0F0728 0%, #1E1B4B 50%, #312E81 100%)
  `;

  // ③ sunset-coral：粉橘 → 紫罗兰渐变（黄昏感）
  const sunsetCoralLayer = `
    radial-gradient(70% 50% at 18% 22%, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0) 70%),
    radial-gradient(60% 45% at 85% 30%, rgba(244,114,182,0.45) 0%, rgba(244,114,182,0) 70%),
    radial-gradient(80% 60% at 70% 95%, rgba(139,92,246,0.45) 0%, rgba(139,92,246,0) 75%),
    radial-gradient(60% 45% at 18% 95%, rgba(252,211,77,0.40) 0%, rgba(252,211,77,0) 75%),
    linear-gradient(160deg, #FFEDD5 0%, #FBCFE8 50%, #C4B5FD 100%)
  `;

  // ④ ocean-fresh：天蓝 → 海蓝渐变 + 柠檬黄光晕
  const oceanFreshLayer = `
    radial-gradient(70% 50% at 100% 0%, rgba(250,204,21,0.30) 0%, rgba(250,204,21,0) 60%),
    radial-gradient(80% 60% at -10% 110%, rgba(37,99,235,0.45) 0%, rgba(37,99,235,0) 65%),
    radial-gradient(35% 28% at 12% 25%, rgba(56,189,248,0.40) 0%, rgba(56,189,248,0) 75%),
    linear-gradient(180deg, #DBEAFE 0%, #93C5FD 60%, #2563EB 100%)
  `;

  // ⑤ business-bright：白底 + 海军蓝弧形 mask + 香槟金 hairline
  const businessBrightLayer = `
    radial-gradient(70% 50% at 100% 0%, rgba(31,58,95,0.18) 0%, rgba(31,58,95,0) 60%),
    radial-gradient(80% 60% at -10% 110%, rgba(31,58,95,0.22) 0%, rgba(31,58,95,0) 65%),
    radial-gradient(35% 28% at 12% 25%, rgba(201,168,88,0.30) 0%, rgba(201,168,88,0) 75%),
    linear-gradient(180deg, #F8FAFC 0%, #EAF0F6 100%)
  `;

  let bgLayer: string;
  let isLightCover = false;

  if (safeBg) {
    const overlayMode =
      style === "neon-tech"
        ? "rgba(15,7,40,0.55)"
        : style === "spring-mint" || style === "sunset-coral" || style === "business-bright"
          ? "rgba(0,0,0,0.30)"
          : "rgba(0,0,0,0.40)";
    // Bug fix 2026-05-01：原本 url("${safeBg}") 双引号跟外层 HTML attribute
    // 的 style="..." 双引号嵌套冲突 → 浏览器在 url(" 处直接关闭 attribute，
    // 后面 2 MB base64 全乱掉，PDF 渲染时封面 div 不渲染图片，只剩调色板。
    // 这就是从 PR #350 起用户一直反馈"PDF 没有封面"的根因！
    // 改成 CSS 不带引号的 url(...) 形式（data URI 不含空格 / 括号 / 引号，合法）。
    bgLayer = `linear-gradient(180deg, ${overlayMode} 0%, rgba(0,0,0,0.10) 38%, ${overlayMode} 100%), url(${safeBg}) center/cover no-repeat`;
    isLightCover = style === "spring-mint" || style === "sunset-coral" || style === "business-bright";
  } else if (style === "spring-mint") {
    bgLayer = springMintLayer;
    isLightCover = true;
  } else if (style === "neon-tech") {
    bgLayer = neonTechLayer;
    isLightCover = false;
  } else if (style === "sunset-coral") {
    bgLayer = sunsetCoralLayer;
    isLightCover = true;
  } else if (style === "ocean-fresh") {
    bgLayer = oceanFreshLayer;
    isLightCover = false; // 深海蓝底用白字
  } else {
    bgLayer = businessBrightLayer;
    isLightCover = true;
  }

  const coverTextClass = isLightCover ? "cover-frame cover-frame-light" : "cover-frame";

  const eyebrow =
    style === "spring-mint" ? "FRESH STRATEGIC INSIGHT"
    : style === "neon-tech" ? "FUTURE OPS · TECH BRIEF"
    : style === "sunset-coral" ? "CREATIVE STRATEGY"
    : style === "ocean-fresh" ? "OCEAN BUSINESS BRIEF"
    : "BUSINESS PLAN";

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
        ${safeAbstract ? `<p class="cover-abstract">${safeAbstract}</p>` : ""}
      </div>
      <div class="cover-bottom">
        <span>MV STUDIO PRO · 战略情报局</span>
        <span class="cover-conf">CONFIDENTIAL · BOARDROOM ONLY</span>
      </div>
    </div>
  </section>`;
}

export function generateHtmlTemplate(
  markdownContent: string,
  opts?: { style?: PdfStyle; cover?: PdfCover },
): string {
  const style: PdfStyle = (opts?.style as PdfStyle) || "spring-mint";
  const palette = buildPalette(style);

  // 用户反馈（2026-05-01）：封面已显示标题 (cover-title)，正文又起 # H1
  // 同一行字 → 视觉重复 / PDF 第一页冗余。剥掉 markdown 开头第一个 H1
  // （仅首个，后续小节标题保留）。HTML 与 PDF 路径同步处理。
  let mdRaw = markdownContent || "";
  if (opts?.cover) {
    mdRaw = mdRaw.replace(/^\s*#\s+[^\n]+\n+/, "");
  }

  const htmlBody = enhanceTables(parseMarkdownToHtml(mdRaw, style));
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
      height: 980px;
      max-height: 980px;
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
      height: 980px;
      padding: 60px 56px;
    }
    .cover-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cover-pill {
      background: rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.22);
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
    .cover-center { max-width: 86%; }
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
    /* ── 浅底封面专用：所有文字换深色 ── */
    .cover-frame-light .cover-pill {
      background: rgba(255,255,255,0.65);
      border: 1px solid rgba(15,23,42,0.10);
      color: ${palette.textMain};
    }
    .cover-frame-light .cover-issue { color: ${palette.textMuted}; }
    .cover-frame-light .cover-eyebrow { color: ${palette.primary}; }
    .cover-frame-light .cover-mega {
      color: ${palette.primary};
      text-shadow: 0 6px 28px rgba(255,255,255,0.5);
    }
    .cover-frame-light .cover-title {
      color: ${palette.textMain};
      text-shadow: none;
    }
    .cover-frame-light .cover-abstract {
      color: ${palette.textMain};
      border-left: 2px solid ${palette.accent};
    }
    .cover-frame-light .cover-bottom {
      color: ${palette.textMuted};
      border-top: 1px solid ${palette.rule};
    }
    .cover-frame-light .cover-conf {
      color: ${palette.confidential};
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
      color: ${palette.primary}10;
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
    h1 {
      font-size: 28px;
      font-weight: 900;
      color: var(--primary);
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
      color: var(--primary);
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

    /* ────────────────── 表格 ────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 12.5px;
      page-break-inside: auto;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
      table-layout: auto;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: auto; page-break-after: auto; }
    thead th {
      background: var(--th-bg);
      color: var(--th-text);
      padding: 11px 13px;
      text-align: left;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      border-bottom: 2px solid var(--primary);
      border-right: 1px solid rgba(255,255,255,0.10);
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
    td.num, th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" on;
      white-space: nowrap;
    }
    td.num.pos { color: #15803D; font-weight: 700; }
    td.num.neg { color: #B91C1C; font-weight: 700; }
    td.lvl-h, td.lvl-m, td.lvl-l {
      text-align: center;
      font-weight: 800;
      letter-spacing: 0.08em;
    }
    td.lvl-h { color: #fff; background: #15803D; border-radius: 4px; }
    td.lvl-m { color: #fff; background: #CA8A04; border-radius: 4px; }
    td.lvl-l { color: #fff; background: #B91C1C; border-radius: 4px; }

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

    code {
      background: ${palette.accent}12;
      padding: 1px 6px;
      border-radius: 3px;
      font-family: "JetBrains Mono", "SF Mono", Menlo, ui-monospace, monospace;
      font-size: 12px;
      color: var(--accent);
    }
    pre {
      background: ${palette.bgElev};
      color: ${palette.primary};
      padding: 14px 16px;
      border-radius: 6px;
      border-left: 3px solid var(--primary);
      overflow-x: auto;
      font-size: 12px;
      page-break-inside: avoid;
    }
    pre code { background: transparent; padding: 0; color: inherit; }

    img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

    /* ────────────────── 自动场景配图（figure + figcaption）─────────────
       排版审美硬约束：
       - 图片整块不允许跨页切（page-break-inside: avoid）
       - 图片不允许撞标题（前后留 28px / 16px 空隙）
       - 图说居中、淡色、英文 small caps 风格
       - 圆角 + 阴影 + 主色细边
       - 最大宽度 100%，最大高度 ~半页（避免一张图独占整页太空）
    */
    figure.scene-figure {
      margin: 28px auto 16px;
      padding: 0;
      max-width: 100%;
      page-break-inside: avoid;
      break-inside: avoid;
      text-align: center;
    }
    figure.scene-figure img {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      max-height: 480px;       /* ≈ A4 半页：避免一张图独占整页 */
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid var(--rule);
      box-shadow: 0 6px 24px rgba(0,0,0,0.10);
    }
    figure.scene-figure figcaption {
      margin-top: 10px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.04em;
      line-height: 1.5;
      font-style: italic;
      max-width: 90%;
      margin-left: auto;
      margin-right: auto;
    }
    /* H2 + figure 紧邻时：缩短间隙避免空白过大 */
    h2 + figure.scene-figure { margin-top: 18px; }
    /* figure 后紧跟段落：拉开距离让正文呼吸 */
    figure.scene-figure + p { margin-top: 18px; }

    /* ────────────────── 数据可视化图表（ECharts SSR SVG）─────────────
       与 figure.scene-figure 风格保持一致，但允许更高（数据图比照片密度高）。
    */
    figure.chart-figure {
      margin: 22px auto 18px;
      padding: 14px 16px 12px;
      max-width: 100%;
      page-break-inside: avoid;
      break-inside: avoid;
      text-align: center;
      background: var(--bg-elev);
      border: 1px solid var(--rule);
      border-radius: 10px;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    figure.chart-figure svg {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      height: auto;
    }
    figure.chart-figure figcaption {
      margin-top: 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.04em;
      line-height: 1.5;
    }
    table + figure.chart-figure { margin-top: 12px; }

    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
      table { page-break-inside: auto; }
      tr, td, th { page-break-inside: auto; page-break-after: auto; }
      blockquote { page-break-inside: auto; }
      figure { page-break-inside: avoid; }
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
