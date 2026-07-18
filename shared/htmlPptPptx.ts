/**
 * 动效 PPT · 可编辑 PPTX 导出（方案 B）
 * 与 HTML 共用 HtmlPptPage[]；保留风格配色与插图（无分步动效）。
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

/** pptxgenjs data 字段：`image/png;base64,...`（可带或不带 data: 前缀） */
export type HtmlPptImageDataUrl = string;

export type BuildHtmlPptPptxOptions = {
  /** url → data URL；缺省则该页无图 */
  imageDataByUrl?: Record<string, HtmlPptImageDataUrl>;
  /** 风格叠底图 data URL（可选，低透明铺满） */
  styleBgDataUrl?: HtmlPptImageDataUrl;
};

function normalizePptxImageData(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,(.+)$/i.exec(s);
    if (!m) return "";
    return `${m[1]};base64,${m[2]}`;
  }
  if (s.includes(";base64,")) return s;
  return `image/png;base64,${s}`;
}

function collectImageUrls(pages: HtmlPptPage[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const u = typeof p.imageUrl === "string" ? p.imageUrl.trim() : "";
    if (!/^https?:\/\//i.test(u) || seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
  }
  return urls;
}

export function listHtmlPptPptxImageUrls(input: HtmlPptDeckInput): string[] {
  return collectImageUrls(normalizeHtmlPptPages(input.pages));
}

/** 生成可编辑 PPTX（Blob，浏览器可直接下载） */
export async function buildHtmlPptPptxBlob(
  input: HtmlPptDeckInput,
  opts?: BuildHtmlPptPptxOptions,
): Promise<Blob> {
  const styleId = (input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research") as HtmlPptStyleId;
  const palette = HTML_PPT_STYLES[styleId].palette;
  const pages = normalizeHtmlPptPages(input.pages);
  if (!pages.length) {
    throw new Error("清单为空，无法导出 PPTX");
  }

  const imageDataByUrl = opts?.imageDataByUrl || {};
  const styleBg = opts?.styleBgDataUrl ? normalizePptxImageData(opts.styleBgDataUrl) : "";

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
  const line = light ? "d4d4d8" : "334155";

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const kind = pageKind(page, i);
    const slide = pptx.addSlide();
    slide.background = { color: bg };

    if (styleBg) {
      try {
        slide.addImage({
          data: styleBg,
          x: 0,
          y: 0,
          w: 13.333,
          h: 7.5,
          transparency: 62,
        });
      } catch {
        /* 叠底失败不阻断导出 */
      }
    }

    // 强调色条（对齐 HTML accent-line）
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 0.32,
      w: 1.35,
      h: 0.06,
      fill: { color: accent },
      line: { color: accent, pt: 0 },
    });

    const imgRaw = typeof page.imageUrl === "string" ? page.imageUrl.trim() : "";
    const imgData = imgRaw && imageDataByUrl[imgRaw] ? normalizePptxImageData(imageDataByUrl[imgRaw]!) : "";
    const hasImage = Boolean(imgData);
    const textW = hasImage ? 7.0 : 12.3;
    const imageX = 7.85;
    const imageW = 4.9;

    slide.addText(`${i + 1} / ${pages.length}`, {
      x: 0.5,
      y: 0.42,
      w: textW,
      h: 0.28,
      fontSize: 11,
      color: muted,
      fontFace: "Arial",
    });

    if (page.kpi && kind !== "cover") {
      slide.addText(page.kpi, {
        x: 0.5,
        y: 0.7,
        w: textW,
        h: 0.45,
        fontSize: 22,
        bold: true,
        color: accent,
        fontFace: "Arial",
      });
    }

    const titleY = page.kpi && kind !== "cover" ? 1.2 : 0.78;
    slide.addText(page.title, {
      x: 0.5,
      y: titleY,
      w: textW,
      h: kind === "cover" ? 1.15 : 0.7,
      fontSize: kind === "cover" ? 34 : 26,
      bold: true,
      color: text,
      fontFace: "Arial",
      valign: "top",
    });

    let cursorY = titleY + (kind === "cover" ? 1.25 : 0.8);

    if (page.subtitle) {
      slide.addText(page.subtitle, {
        x: 0.5,
        y: cursorY,
        w: textW,
        h: 0.42,
        fontSize: 14,
        color: muted,
        fontFace: "Arial",
      });
      cursorY += 0.5;
    }

    const bullets = (page.bullets || []).filter(Boolean).slice(0, 8);
    const series = page.series || [];
    const bulletW = hasImage ? textW : series.length ? 6.4 : 12.2;

    if (bullets.length) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: 0.55,
          y: cursorY,
          w: bulletW,
          h: Math.min(hasImage ? 3.2 : 3.8, 0.38 * bullets.length + 0.2),
          fontSize: 15,
          color: text,
          fontFace: "Arial",
          valign: "top",
        },
      );
    }

    if (series.length && !hasImage) {
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
        ...series.slice(0, 8).map((s) => [cell(s.label), cell(String(Math.round(s.value * 10) / 10))]),
      ];
      const tableX = bullets.length ? 7.3 : 0.5;
      const tableW = bullets.length ? 5.5 : 12.3;
      slide.addTable(rows, {
        x: tableX,
        y: Math.max(cursorY, titleY + 1.1),
        w: tableW,
        colW: [tableW * 0.62, tableW * 0.38],
        border: { pt: 0.5, color: line },
        fontFace: "Arial",
        fontSize: 12,
      });
    } else if (series.length && hasImage) {
      // 有插图时表格压在正文区下方，避免挡图
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
        ...series.slice(0, 5).map((s) => [cell(s.label), cell(String(Math.round(s.value * 10) / 10))]),
      ];
      const tableY = Math.min(5.35, cursorY + (bullets.length ? Math.min(2.6, 0.36 * bullets.length) + 0.15 : 0.1));
      slide.addTable(rows, {
        x: 0.5,
        y: tableY,
        w: textW,
        colW: [textW * 0.62, textW * 0.38],
        border: { pt: 0.5, color: line },
        fontFace: "Arial",
        fontSize: 11,
      });
    }

    if (hasImage) {
      // 卡片底衬 + 插图（对齐 HTML 右停靠态）
      slide.addShape(pptx.ShapeType.roundRect, {
        x: imageX - 0.08,
        y: 0.95,
        w: imageW + 0.16,
        h: 5.35,
        fill: { color: card },
        line: { color: line, pt: 0.75 },
        rectRadius: 0.12,
      });
      try {
        slide.addImage({
          data: imgData,
          x: imageX,
          y: 1.1,
          w: imageW,
          h: 5.05,
          sizing: { type: "contain", w: imageW, h: 5.05 },
        });
      } catch {
        throw new Error("插图写入 PPTX 失败，请重试导出");
      }
    } else if (imgRaw) {
      throw new Error("有插图页未能载入图片数据，请重试导出");
    }

    if (page.note) {
      slide.addText(page.note, {
        x: 0.5,
        y: 6.9,
        w: hasImage ? textW : 12.3,
        h: 0.4,
        fontSize: 11,
        color: muted,
        fontFace: "Arial",
      });
    }
  }

  const out = await pptx.write({ outputType: "blob" });
  return out as Blob;
}

/** 触发浏览器下载 .pptx（须先由调用方备好 imageDataByUrl） */
export async function downloadHtmlPptPptx(
  input: HtmlPptDeckInput,
  filename?: string,
  opts?: BuildHtmlPptPptxOptions,
): Promise<void> {
  const blob = await buildHtmlPptPptxBlob(input, opts);
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
