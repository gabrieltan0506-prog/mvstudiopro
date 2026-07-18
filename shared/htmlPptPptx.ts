/**
 * 动效 PPT · 可编辑 PPTX 导出（方案 B）
 * 与 HTML 共用 HtmlPptPage[]；用 pptxgenjs 输出标题/要点/表格，便于本地填隐私数。
 */
import PptxGenJS from "pptxgenjs";
import {
  HTML_PPT_STYLES,
  normalizeHtmlPptPages,
  type HtmlPptDeckInput,
  type HtmlPptPage,
  type HtmlPptStyleId,
} from "./htmlPptMaker";

function hex(color: string): string {
  return String(color || "").replace(/^#/, "").slice(0, 6) || "111111";
}

function isLightBg(bg: string): boolean {
  const h = hex(bg);
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function pageKind(page: HtmlPptPage, index: number): "cover" | "toc" | "body" | "end" {
  if (index === 0) return "cover";
  const t = `${page.title}${page.subtitle || ""}`;
  if (/目录|议程|议题|叙事线/.test(t) || page.viz === "hub" || page.viz === "steps") {
    if (index <= 1) return "toc";
  }
  if (/结语|下一步|行动|谢谢|总结/.test(t)) return "end";
  return "body";
}

/** 生成可编辑 PPTX（Blob，浏览器可直接下载） */
export async function buildHtmlPptPptxBlob(input: HtmlPptDeckInput): Promise<Blob> {
  const styleId = (input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research") as HtmlPptStyleId;
  const palette = HTML_PPT_STYLES[styleId].palette;
  const pages = normalizeHtmlPptPages(input.pages);
  if (!pages.length) {
    throw new Error("清单为空，无法导出 PPTX");
  }

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "HTML_PPT_16x9", width: 13.333, height: 7.5 });
  pptx.layout = "HTML_PPT_16x9";
  pptx.author = "MV Studio";
  pptx.title = String(input.title || "演示").slice(0, 80);

  const bg = hex(palette.bg);
  const text = hex(palette.text);
  const muted = hex(palette.muted);
  const accent = hex(palette.accent);
  const card = hex(palette.card);
  const light = isLightBg(palette.bg);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const kind = pageKind(page, i);
    const slide = pptx.addSlide();
    slide.background = { color: bg };

    slide.addText(`${i + 1} / ${pages.length}`, {
      x: 0.5,
      y: 0.28,
      w: 12.3,
      h: 0.28,
      fontSize: 11,
      color: muted,
      fontFace: "Arial",
    });

    if (page.kpi && kind !== "cover") {
      slide.addText(page.kpi, {
        x: 0.5,
        y: 0.55,
        w: 12.3,
        h: 0.45,
        fontSize: 22,
        bold: true,
        color: accent,
        fontFace: "Arial",
      });
    }

    const titleY = page.kpi && kind !== "cover" ? 1.05 : 0.7;
    slide.addText(page.title, {
      x: 0.5,
      y: titleY,
      w: 12.3,
      h: kind === "cover" ? 1.2 : 0.7,
      fontSize: kind === "cover" ? 36 : 28,
      bold: true,
      color: text,
      fontFace: "Arial",
      valign: "top",
    });

    let cursorY = titleY + (kind === "cover" ? 1.35 : 0.85);

    if (page.subtitle) {
      slide.addText(page.subtitle, {
        x: 0.5,
        y: cursorY,
        w: 12.3,
        h: 0.45,
        fontSize: 14,
        color: muted,
        fontFace: "Arial",
      });
      cursorY += 0.55;
    }

    const bullets = (page.bullets || []).filter(Boolean).slice(0, 8);
    if (bullets.length) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: 0.55,
          y: cursorY,
          w: page.series?.length ? 6.4 : 12.2,
          h: Math.min(3.8, 0.38 * bullets.length + 0.2),
          fontSize: 15,
          color: text,
          fontFace: "Arial",
          valign: "top",
        },
      );
    }

    if (page.series?.length) {
      const cell = (label: string, opts?: { bold?: boolean }) => ({
        text: label,
        options: {
          bold: Boolean(opts?.bold),
          color: text,
          fill: { color: card },
          align: "left" as const,
          valign: "middle" as const,
        },
      });
      const rows = [
        [cell("项目", { bold: true }), cell("数值（可改）", { bold: true })],
        ...page.series
          .slice(0, 8)
          .map((s) => [cell(s.label), cell(String(Math.round(s.value * 10) / 10))]),
      ];
      const tableX = bullets.length ? 7.3 : 0.5;
      const tableW = bullets.length ? 5.5 : 12.3;
      slide.addTable(rows, {
        x: tableX,
        y: Math.max(cursorY, titleY + 1.1),
        w: tableW,
        colW: [tableW * 0.62, tableW * 0.38],
        border: { pt: 0.5, color: light ? "d4d4d8" : "334155" },
        fontFace: "Arial",
        fontSize: 12,
      });
    }

    if (page.note) {
      slide.addText(page.note, {
        x: 0.5,
        y: 6.85,
        w: 12.3,
        h: 0.4,
        fontSize: 11,
        color: muted,
        fontFace: "Arial",
      });
    }

    // MVP：插图不嵌入（避免跨域）；用户可在 PPT 里自行贴图。P1.5 再做 HTTPS 图嵌入。
    if (page.imageUrl && /^https?:\/\//i.test(page.imageUrl)) {
      slide.addText("【插图占位·可删除后自行替换】", {
        x: 9.0,
        y: 6.35,
        w: 3.8,
        h: 0.35,
        fontSize: 10,
        color: muted,
        fontFace: "Arial",
      });
    }
  }

  const out = await pptx.write({ outputType: "blob" });
  return out as Blob;
}

/** 触发浏览器下载 .pptx */
export async function downloadHtmlPptPptx(input: HtmlPptDeckInput, filename?: string): Promise<void> {
  const blob = await buildHtmlPptPptxBlob(input);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const base =
    filename ||
    `${String(input.title || "website-ppt")
      .slice(0, 24)
      .replace(/\s+/g, "-")}.pptx`;
  a.download = base.endsWith(".pptx") ? base : `${base}.pptx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
