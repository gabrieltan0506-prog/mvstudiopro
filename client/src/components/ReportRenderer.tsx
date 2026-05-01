import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { PdfStyleKey } from "@/components/TemplatePicker";

/**
 * 战略战报富文本渲染器
 * - 解析 Markdown：标题、表格、列表、引用、分隔线、加粗、行内代码
 * - 表格统一渲染为奢华黑金风格
 * - 数值型表格自动衍生柱状图 / 折线图 / 雷达图
 * - 标题与关键词高亮配色，提升层次感
 * - 全部样式内联，方便 html-to-image 截图导出
 * - 识别 `<figure class="scene-figure">...</figure>` / `<img>` 等场景图 raw HTML
 *   并以 dangerouslySetInnerHTML 直出（不再字面打印 < > 字符串）
 * - 通过 pdfStyle prop 切换 5 套配色（spring-mint / neon-tech / sunset-coral /
 *   ocean-fresh / business-bright），与导出 PDF 的封面模板保持一致
 */

// ───────────────────────────────────────────────────────────────────────────
// 配色（默认卡布奇诺，可通过 pdfStyle 切换）

interface ColorPalette {
  bg: string;
  bgDeep: string;
  panel: string;
  panelAlt: string;
  ink: string;
  inkSoft: string;
  gold: string;
  goldDeep: string;
  goldLight: string;
  cocoa: string;
  cream: string;
  rose: string;
  emerald: string;
  ocean: string;
  amber: string;
  divider: string;
  cardShadow: string;
  bgGradient: string;
  h1Gradient: string;
  tableHeadGradient: string;
  hrGradient: string;
  chartPalette: string[];
}

// 卡布奇诺咖啡色系（旧版默认，保留用于兜底 / SampleReportDownload 等场景）
const CAPPUCCINO: ColorPalette = {
  bg: "#f7ede0",
  bgDeep: "#ede0c9",
  panel: "#fffaf0",
  panelAlt: "#f5ecda",
  ink: "#2a1c0e",
  inkSoft: "#4a3621",
  gold: "#a8761b",
  goldDeep: "#7a5410",
  goldLight: "#d8a23a",
  cocoa: "#6b4423",
  cream: "#faf3e6",
  rose: "#b6364c",
  emerald: "#1f7a52",
  ocean: "#2160a0",
  amber: "#d8841a",
  divider: "rgba(122,84,16,0.22)",
  cardShadow: "0 6px 28px rgba(74,54,33,0.10), 0 2px 6px rgba(74,54,33,0.06)",
  bgGradient: `linear-gradient(180deg,#faf3e6 0%,#f7ede0 35%,#f5ecda 75%,#f7ede0 100%)`,
  h1Gradient: `linear-gradient(90deg,#6b4423 0%,#a8761b 55%,#d8a23a 100%)`,
  tableHeadGradient: `linear-gradient(90deg,#7a5410 0%,#a8761b 50%,#7a5410 100%)`,
  hrGradient: `linear-gradient(90deg, transparent, rgba(168,118,27,0.45), transparent)`,
  chartPalette: ["#a8761b", "#b6364c", "#2160a0", "#1f7a52", "#d8841a", "#7a5410"],
};

// 5 套与 HTML 离线模板对齐的 ReportRenderer 调色板（server/services/htmlReportTemplate.ts buildHtmlPalette 一致）
const THEME_PALETTES: Record<PdfStyleKey, ColorPalette> = {
  // ① 春日薄荷：薄荷绿 + 樱桃粉
  "spring-mint": {
    bg: "#FFFFFF",
    bgDeep: "#ECFDF5",
    panel: "#FFFFFF",
    panelAlt: "#F0FDF4",
    ink: "#0F172A",
    inkSoft: "#475569",
    gold: "#10B981",
    goldDeep: "#047857",
    goldLight: "#FB7185",
    cocoa: "#065F46",
    cream: "#FFFBEB",
    rose: "#FB7185",
    emerald: "#10B981",
    ocean: "#06B6D4",
    amber: "#F59E0B",
    divider: "rgba(16,185,129,0.22)",
    cardShadow: "0 6px 28px rgba(15,118,110,0.10), 0 2px 6px rgba(15,118,110,0.06)",
    bgGradient: `linear-gradient(180deg,#FFFFFF 0%,#F0FDF4 35%,#ECFDF5 75%,#FFE4E6 100%)`,
    h1Gradient: `linear-gradient(90deg,#047857 0%,#10B981 55%,#FB7185 100%)`,
    tableHeadGradient: `linear-gradient(90deg,#10B981 0%,#34D399 50%,#FB7185 100%)`,
    hrGradient: `linear-gradient(90deg, transparent, rgba(16,185,129,0.45), transparent)`,
    chartPalette: ["#10B981", "#FB7185", "#06B6D4", "#F59E0B", "#8B5CF6", "#047857"],
  },
  // ② 霓虹科技：电光青 + 霓虹紫（深底）
  "neon-tech": {
    bg: "#FAFBFF",
    bgDeep: "#EDE9FE",
    panel: "#FFFFFF",
    panelAlt: "#F5F3FF",
    ink: "#1E1B4B",
    inkSoft: "#6B7280",
    gold: "#7C3AED",
    goldDeep: "#5B21B6",
    goldLight: "#06B6D4",
    cocoa: "#312E81",
    cream: "#F5F3FF",
    rose: "#EC4899",
    emerald: "#06B6D4",
    ocean: "#3B82F6",
    amber: "#F59E0B",
    divider: "rgba(124,58,237,0.22)",
    cardShadow: "0 6px 28px rgba(91,33,182,0.10), 0 2px 6px rgba(91,33,182,0.06)",
    bgGradient: `linear-gradient(180deg,#FAFBFF 0%,#F5F3FF 35%,#EDE9FE 75%,#E0F2FE 100%)`,
    h1Gradient: `linear-gradient(90deg,#5B21B6 0%,#7C3AED 55%,#06B6D4 100%)`,
    tableHeadGradient: `linear-gradient(90deg,#5B21B6 0%,#7C3AED 50%,#06B6D4 100%)`,
    hrGradient: `linear-gradient(90deg, transparent, rgba(124,58,237,0.45), transparent)`,
    chartPalette: ["#7C3AED", "#06B6D4", "#EC4899", "#3B82F6", "#F59E0B", "#5B21B6"],
  },
  // ③ 日落珊瑚：珊瑚橘 + 紫罗兰
  "sunset-coral": {
    bg: "#FFFAF5",
    bgDeep: "#FFEDD5",
    panel: "#FFFFFF",
    panelAlt: "#FFF7ED",
    ink: "#3C1361",
    inkSoft: "#7C5C8B",
    gold: "#8B5CF6",
    goldDeep: "#6D28D9",
    goldLight: "#FB923C",
    cocoa: "#7C2D12",
    cream: "#FFF7ED",
    rose: "#F472B6",
    emerald: "#10B981",
    ocean: "#3B82F6",
    amber: "#FB923C",
    divider: "rgba(139,92,246,0.22)",
    cardShadow: "0 6px 28px rgba(124,58,237,0.10), 0 2px 6px rgba(124,58,237,0.06)",
    bgGradient: `linear-gradient(180deg,#FFFAF5 0%,#FFEDD5 35%,#FCE7F3 75%,#EDE9FE 100%)`,
    h1Gradient: `linear-gradient(90deg,#6D28D9 0%,#8B5CF6 55%,#FB923C 100%)`,
    tableHeadGradient: `linear-gradient(90deg,#6D28D9 0%,#8B5CF6 50%,#FB923C 100%)`,
    hrGradient: `linear-gradient(90deg, transparent, rgba(139,92,246,0.45), transparent)`,
    chartPalette: ["#8B5CF6", "#FB923C", "#F472B6", "#3B82F6", "#10B981", "#6D28D9"],
  },
  // ④ 海蓝清爽：海蓝 + 柠檬黄
  "ocean-fresh": {
    bg: "#F8FAFF",
    bgDeep: "#DBEAFE",
    panel: "#FFFFFF",
    panelAlt: "#EFF6FF",
    ink: "#0C1A3D",
    inkSoft: "#475569",
    gold: "#2563EB",
    goldDeep: "#1E40AF",
    goldLight: "#FACC15",
    cocoa: "#1E3A8A",
    cream: "#EFF6FF",
    rose: "#F472B6",
    emerald: "#10B981",
    ocean: "#0EA5E9",
    amber: "#FACC15",
    divider: "rgba(37,99,235,0.22)",
    cardShadow: "0 6px 28px rgba(30,64,175,0.10), 0 2px 6px rgba(30,64,175,0.06)",
    bgGradient: `linear-gradient(180deg,#F8FAFF 0%,#EFF6FF 35%,#DBEAFE 75%,#E0F2FE 100%)`,
    h1Gradient: `linear-gradient(90deg,#1E40AF 0%,#2563EB 55%,#FACC15 100%)`,
    tableHeadGradient: `linear-gradient(90deg,#1E40AF 0%,#2563EB 50%,#0EA5E9 100%)`,
    hrGradient: `linear-gradient(90deg, transparent, rgba(37,99,235,0.45), transparent)`,
    chartPalette: ["#2563EB", "#FACC15", "#0EA5E9", "#10B981", "#F472B6", "#1E40AF"],
  },
  // ⑤ 高端商务亮：海军蓝 + 香槟金
  "business-bright": {
    bg: "#F8FAFC",
    bgDeep: "#EAF0F6",
    panel: "#FFFFFF",
    panelAlt: "#F1F5F9",
    ink: "#0F1B2D",
    inkSoft: "#55657A",
    gold: "#1F3A5F",
    goldDeep: "#162B47",
    goldLight: "#C9A858",
    cocoa: "#1E293B",
    cream: "#F8FAFC",
    rose: "#B6364C",
    emerald: "#15803D",
    ocean: "#1F3A5F",
    amber: "#C9A858",
    divider: "rgba(31,58,95,0.22)",
    cardShadow: "0 6px 28px rgba(15,27,45,0.10), 0 2px 6px rgba(15,27,45,0.06)",
    bgGradient: `linear-gradient(180deg,#F8FAFC 0%,#F1F5F9 35%,#EAF0F6 75%,#F8FAFC 100%)`,
    h1Gradient: `linear-gradient(90deg,#162B47 0%,#1F3A5F 55%,#C9A858 100%)`,
    tableHeadGradient: `linear-gradient(90deg,#162B47 0%,#1F3A5F 50%,#C9A858 100%)`,
    hrGradient: `linear-gradient(90deg, transparent, rgba(31,58,95,0.45), transparent)`,
    chartPalette: ["#1F3A5F", "#C9A858", "#0EA5E9", "#15803D", "#B6364C", "#162B47"],
  },
};

function resolveColors(pdfStyle?: PdfStyleKey): ColorPalette {
  if (pdfStyle && THEME_PALETTES[pdfStyle]) return THEME_PALETTES[pdfStyle];
  // 没传 pdfStyle 则默认走春日薄荷（与导出 PDF 默认模板一致）。
  return THEME_PALETTES["spring-mint"];
}

// ───────────────────────────────────────────────────────────────────────────
// 类型与解析

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "divider" }
  | { kind: "table"; headers: string[]; rows: string[][]; caption?: string }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "html"; html: string };

// 已知的多行 raw HTML 块外层标签。遇到这些标签开头时，会一直读到匹配的闭合
// 标签为止整体作为一个 html block 输出（避免 `<figure class="scene-figure">`
// 这种多行片段被当成普通段落，字面字符显示在阅读视图里）。
const RAW_HTML_BLOCK_TAGS = ["figure", "table", "section", "article", "aside", "div"];

function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const flushList = (items: string[], ordered: boolean) => {
    if (items.length) blocks.push({ kind: "list", ordered, items });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ kind: "heading", level, text: headingMatch[2] });
      i++;
      continue;
    }

    if (/^(---+|===+|\*\*\*+)$/.test(trimmed)) {
      blocks.push({ kind: "divider" });
      i++;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(trimmed);
    if (imgMatch) {
      blocks.push({ kind: "image", alt: imgMatch[1], src: imgMatch[2] });
      i++;
      continue;
    }

    // 多行 raw HTML 块（<figure>…</figure> / <table>…</table> 等）。注入场景图时
    // deepResearchService 会输出 `<figure class="scene-figure">…</figure>` 多行
    // 片段，必须整体收集为一个 html block 才能正确渲染。
    const rawTagMatch = /^<([a-zA-Z]+)[\s>]/.exec(trimmed);
    if (rawTagMatch && RAW_HTML_BLOCK_TAGS.includes(rawTagMatch[1].toLowerCase())) {
      const tag = rawTagMatch[1].toLowerCase();
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      // 同行就闭合的情况
      if (closeRe.test(trimmed)) {
        blocks.push({ kind: "html", html: trimmed });
        i++;
        continue;
      }
      const buf: string[] = [lines[i]];
      i++;
      while (i < lines.length) {
        buf.push(lines[i]);
        if (closeRe.test(lines[i])) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({ kind: "html", html: buf.join("\n") });
      continue;
    }

    // 单行的 <img …/>
    if (/^<img\s/i.test(trimmed)) {
      blocks.push({ kind: "html", html: trimmed });
      i++;
      continue;
    }

    if (
      /^\|.+\|$/.test(trimmed) &&
      i + 1 < lines.length &&
      /^\|?\s*:?-{2,}.*$/.test(lines[i + 1].trim())
    ) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      flushList(items, true);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      flushList(items, false);
      continue;
    }

    const para: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^\|.+\|$/.test(lines[i].trim()) &&
      !/^(---+|===+|\*\*\*+)$/.test(lines[i].trim()) &&
      !/^<([a-zA-Z]+)[\s>]/.test(lines[i].trim()) // 不要把后续 raw HTML 行卷进段落
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

function splitTableRow(line: string): string[] {
  let raw = line.trim();
  if (raw.startsWith("|")) raw = raw.slice(1);
  if (raw.endsWith("|")) raw = raw.slice(0, -1);
  return raw.split("|").map((c) => c.trim());
}

// ───────────────────────────────────────────────────────────────────────────
// 行内文本：加粗、行内代码、斜体

function renderInline(text: string, colors: ColorPalette): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|<br\s*\/?>)/gi);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^<br\s*\/?>$/i.test(p)) return <br key={i} />;
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong
          key={i}
          style={{
            color: colors.goldDeep,
            fontWeight: 800,
            background: `linear-gradient(180deg, transparent 70%, ${colors.goldLight}48 70%)`,
            padding: "0 2px",
          }}
        >
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code
          key={i}
          style={{
            background: `${colors.gold}1f`,
            padding: "1px 6px",
            borderRadius: 4,
            color: colors.goldDeep,
            fontSize: 12,
            fontFamily: "ui-monospace,monospace",
          }}
        >
          {p.slice(1, -1)}
        </code>
      );
    return <span key={i}>{p}</span>;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 数值识别 + 自动图表

function parseNumber(cell: string): number | null {
  if (!cell) return null;
  const s = cell.replace(/<br\s*\/?>/gi, " ");
  const m = s.match(/-?\d[\d,，.]*/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/[,，]/g, ""));
  if (Number.isNaN(n)) return null;
  if (/亿/.test(s)) return n * 1e8;
  if (/万/.test(s)) return n * 1e4;
  if (/千/.test(s)) return n * 1000;
  return n;
}

function isNumericRange(values: number[]): boolean {
  if (values.length < 2) return false;
  return values.every((v) => Number.isFinite(v));
}

interface ChartData {
  type: "bar" | "line" | "radar" | null;
  data: Array<Record<string, unknown>>;
  numericKeys: string[];
  labelKey: string;
}

function deriveChartFromTable(headers: string[], rows: string[][]): ChartData {
  if (headers.length < 2 || rows.length < 2) {
    return { type: null, data: [], numericKeys: [], labelKey: "" };
  }
  const labelKey = headers[0];
  const numericKeys: string[] = [];
  for (let c = 1; c < headers.length; c++) {
    const colVals = rows.map((r) => parseNumber(r[c] || ""));
    const nums = colVals.filter((v): v is number => v !== null);
    if (nums.length >= Math.max(2, Math.floor(rows.length * 0.6))) {
      numericKeys.push(headers[c]);
    }
  }
  if (numericKeys.length === 0) return { type: null, data: [], numericKeys: [], labelKey };

  const data: Array<Record<string, unknown>> = rows
    .map((r) => {
      const item: Record<string, unknown> = { [labelKey]: r[0] || "" };
      headers.slice(1).forEach((h, idx) => {
        if (numericKeys.includes(h)) {
          item[h] = parseNumber(r[idx + 1] || "") ?? 0;
        }
      });
      return item;
    })
    .filter((item) => isNumericRange(numericKeys.map((k) => item[k] as number)));

  if (data.length < 2) return { type: null, data: [], numericKeys: [], labelKey };

  const headerStr = headers.join(" ");
  const labelStr = data.map((d) => String(d[labelKey])).join(" ");
  let type: "bar" | "line" | "radar" = "bar";
  if (/雷达|维度|能力|评分|短板|画像|象限/.test(headerStr + labelStr)) type = "radar";
  else if (/年|月|周|日|阶段|期|Day|Q[1-4]|2024|2025|2026/.test(labelStr)) type = "line";

  return { type, data, numericKeys, labelKey };
}

// ───────────────────────────────────────────────────────────────────────────
// 渲染：表格 + 图表

function TableBlock({ headers, rows, colors }: { headers: string[]; rows: string[][]; colors: ColorPalette }) {
  return (
    <div
      style={{
        margin: "20px 0",
        borderRadius: 14,
        background: colors.panel,
        boxShadow: colors.cardShadow,
        border: `1px solid ${colors.divider}`,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: colors.ink }}>
          <thead>
            <tr style={{ background: colors.tableHeadGradient }}>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "12px 14px",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 13,
                    textAlign: "left",
                    letterSpacing: "0.04em",
                    borderRight: i < headers.length - 1 ? "1px solid rgba(255,255,255,0.18)" : "none",
                  }}
                >
                  {renderInline(h, colors)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? colors.panelAlt : colors.panel }}>
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "11px 14px",
                      verticalAlign: "top",
                      borderRight: ci < r.length - 1 ? `1px dashed ${colors.divider}` : "none",
                      borderTop: `1px solid ${colors.divider}`,
                      color: ci === 0 ? colors.goldDeep : colors.inkSoft,
                      fontWeight: ci === 0 ? 700 : 500,
                      lineHeight: 1.65,
                    }}
                  >
                    {renderInline(cell, colors)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartFromTable({ chart, colors }: { chart: ChartData; colors: ColorPalette }) {
  if (!chart.type || !chart.data.length) return null;

  const tooltipStyle = {
    background: colors.panel,
    border: `1px solid ${colors.gold}`,
    borderRadius: 8,
    boxShadow: colors.cardShadow,
    fontSize: 12,
    color: colors.ink,
  };

  const commonGrid = (
    <CartesianGrid strokeDasharray="3 3" stroke={colors.divider} />
  );

  const palette = colors.chartPalette;

  return (
    <div
      style={{
        margin: "12px 0 28px",
        padding: "16px 18px 12px",
        background: colors.panel,
        borderRadius: 14,
        border: `1px solid ${colors.divider}`,
        boxShadow: colors.cardShadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: colors.goldDeep,
            letterSpacing: "0.1em",
            background: `${colors.gold}1a`,
            padding: "3px 10px",
            borderRadius: 99,
          }}
        >
          数据可视化
        </span>
        <span style={{ fontSize: 12, color: colors.inkSoft }}>
          根据上方表格自动生成 · 仅展示数值列对比
        </span>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          {chart.type === "bar" ? (
            <BarChart data={chart.data} margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
              {commonGrid}
              <XAxis dataKey={chart.labelKey} tick={{ fill: colors.inkSoft, fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fill: colors.inkSoft, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: colors.ink }} />
              {chart.numericKeys.map((key, idx) => (
                <Bar key={key} dataKey={key} fill={palette[idx % palette.length]} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          ) : chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
              {commonGrid}
              <XAxis dataKey={chart.labelKey} tick={{ fill: colors.inkSoft, fontSize: 11 }} />
              <YAxis tick={{ fill: colors.inkSoft, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: colors.ink }} />
              {chart.numericKeys.map((key, idx) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={palette[idx % palette.length]}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: palette[idx % palette.length] }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          ) : (
            <RadarChart data={chart.data} margin={{ top: 12, right: 24, left: 24, bottom: 12 }}>
              <PolarGrid stroke={colors.divider} />
              <PolarAngleAxis dataKey={chart.labelKey} tick={{ fill: colors.ink, fontSize: 11 }} />
              <PolarRadiusAxis tick={{ fill: colors.inkSoft, fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: colors.ink }} />
              {chart.numericKeys.map((key, idx) => (
                <Radar
                  key={key}
                  name={key}
                  dataKey={key}
                  stroke={palette[idx % palette.length]}
                  fill={palette[idx % palette.length]}
                  fillOpacity={0.32}
                />
              ))}
            </RadarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 主组件

export interface ReportRendererProps {
  markdown: string;
  className?: string;
  /** 容器内边距 */
  padding?: number | string;
  /** 关闭自动图表 */
  noAutoChart?: boolean;
  /** 选用的 PDF 模板配色（默认 spring-mint），切换时实时变色 */
  pdfStyle?: PdfStyleKey;
}

export default function ReportRenderer({
  markdown,
  className,
  padding,
  noAutoChart,
  pdfStyle,
}: ReportRendererProps) {
  const colors = useMemo(() => resolveColors(pdfStyle), [pdfStyle]);
  const blocks = useMemo(() => parseMarkdown(markdown || ""), [markdown]);

  return (
    <div
      className={className}
      data-report-surface
      style={{
        background: colors.bgGradient,
        color: colors.ink,
        padding: padding ?? "44px 56px",
        borderRadius: 18,
        fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif",
        fontSize: 15.5,
        lineHeight: 1.9,
        boxShadow: colors.cardShadow,
        border: `1px solid ${colors.divider}`,
      }}
    >
      <div
        style={{
          height: 6,
          margin: "-44px -56px 30px",
          background: colors.h1Gradient,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
        }}
      />

      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "heading":
            return <Heading key={idx} block={b} colors={colors} />;
          case "paragraph":
            return (
              <p key={idx} style={{ margin: "10px 0", color: colors.inkSoft, fontSize: 15.5, lineHeight: 1.95, textAlign: "justify" }}>
                {renderInline(b.text, colors)}
              </p>
            );
          case "list":
            return b.ordered ? (
              <ol key={idx} style={{ margin: "12px 0 16px 4px", paddingLeft: 24, color: colors.inkSoft }}>
                {b.items.map((it, i) => (
                  <li key={i} style={{ margin: "6px 0", lineHeight: 1.85 }}>
                    {renderInline(it, colors)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={idx} style={{ margin: "12px 0 16px 4px", paddingLeft: 22, listStyle: "none", color: colors.inkSoft }}>
                {b.items.map((it, i) => (
                  <li key={i} style={{ margin: "6px 0", position: "relative", paddingLeft: 18, lineHeight: 1.85 }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 10,
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: `linear-gradient(135deg,${colors.goldLight},${colors.goldDeep})`,
                      }}
                    />
                    {renderInline(it, colors)}
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote
                key={idx}
                style={{
                  margin: "16px 0",
                  padding: "14px 20px",
                  borderLeft: `4px solid ${colors.gold}`,
                  background: `linear-gradient(90deg, ${colors.goldLight}1a, ${colors.goldLight}05)`,
                  borderRadius: 8,
                  color: colors.goldDeep,
                  fontStyle: "normal",
                  fontWeight: 600,
                  fontSize: 14.5,
                }}
              >
                <span style={{ marginRight: 8, fontSize: 18 }}>“</span>
                {renderInline(b.text, colors)}
                <span style={{ marginLeft: 6, fontSize: 18 }}>”</span>
              </blockquote>
            );
          case "divider":
            return (
              <div
                key={idx}
                style={{
                  margin: "26px 0",
                  height: 1,
                  background: colors.hrGradient,
                }}
              />
            );
          case "image":
            return (
              <div key={idx} style={{ margin: "16px 0", textAlign: "center" }}>
                <img src={b.src} alt={b.alt || ""} style={{ maxWidth: "100%", borderRadius: 10, boxShadow: colors.cardShadow }} />
              </div>
            );
          case "html":
            // raw HTML 直出（场景图 figure 块、独立 img 标签等）
            // 报告内容由后端 LLM 生成 + 服务端 escapeHtml 处理 alt/caption，注入路径可控；
            // 仍按"显示侧 sanitize 风险已知最小化"原则不做额外 DOMPurify，如需更强校验
            // 可后续在 server/services/deepResearchService.ts injectSceneImagesIntoMarkdown
            // 收紧白名单。
            return (
              <div
                key={idx}
                className="report-raw-html"
                style={{ margin: "20px 0", textAlign: "center" }}
                dangerouslySetInnerHTML={{ __html: b.html }}
              />
            );
          case "table": {
            const chart = noAutoChart ? null : deriveChartFromTable(b.headers, b.rows);
            return (
              <div key={idx}>
                <TableBlock headers={b.headers} rows={b.rows} colors={colors} />
                {chart && chart.type ? <ChartFromTable chart={chart} colors={colors} /> : null}
              </div>
            );
          }
          default:
            return null;
        }
      })}

      {/* 让 raw HTML 里的 figure / img 拥有合理的默认排版（图片宽度自适应、caption 居中）
          + @media print 跨页规则：PR pdf-v2-platformpage-mode 之后 PDF 源 HTML 来自客户端
          DOM 抓取（document.documentElement.cloneNode → mvAnalysis.downloadPlatformPdf →
          puppeteer），所以 print 媒介规则必须写在客户端组件里才会被 Chromium 识别。
          原 server/services/pdfTemplate.ts 的 print rules 随该文件一起删除，这里是新归属。 */}
      <style>{`
        .report-raw-html figure { margin: 16px 0; padding: 0; }
        .report-raw-html figure img { max-width: 100%; height: auto; border-radius: 10px; box-shadow: ${colors.cardShadow}; }
        .report-raw-html figcaption { margin-top: 8px; font-size: 12.5px; color: ${colors.inkSoft}; font-style: italic; line-height: 1.65; }
        .report-raw-html img { max-width: 100%; height: auto; border-radius: 10px; }

        @media print {
          /* 列印環境淨化：避免外層留白把封面擠到第二頁（與精準快照 #myreports-pdf-root 配合） */
          html, body {
            height: auto !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }
          #myreports-pdf-root {
            margin: 0 !important;
            padding: 0 !important;
            max-width: none !important;
          }

          /* MyReports 阅读模式外层壳（screen 用 min-height:100vh + 渐变）。
             打印时务必取消 min-height:100vh，否则易与封面分页规则干涉、造成首页异常。 */
          [data-pdf-reading-shell="true"] {
            min-height: auto !important;
            height: auto !important;
            background: transparent !important;
          }

          /* 长表格 / 行 / 单元格 / 引用块允许跨页断开，防止整段内容被裁切 */
          table { page-break-inside: auto !important; width: 100% !important; }
          tr, td, th { page-break-inside: auto !important; page-break-after: auto !important; }
          blockquote { page-break-inside: auto !important; }
          pre, code { page-break-inside: auto !important; white-space: pre-wrap !important; word-break: break-word !important; }

          /* 标题尽量不在页底孤立，强制把标题与下一段绑在一起 */
          h1, h2, h3 { page-break-after: avoid; break-after: avoid; }

          /* 图片 / 图表 figure 不被中间切断（除非自身就比一页还高） */
          figure, img, .echart-mount { page-break-inside: avoid; break-inside: avoid; }

          /* 封面單獨一頁：禁止用 99vh 撐滿——在 Chromium page.pdf() 裡 vh 常大於實際 A4
             可列印高度，整個 figure 會被 break-inside:avoid 推到第 2 頁 → 第 1 頁空白。 */
          .cover-page, .cover-page.cover-image-only {
            page-break-before: auto !important;
            break-before: auto !important;
            page-break-after: always !important;
            break-after: page !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: 272mm !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
          }
          /* 封面圖：以紙張可列印高度為硬上限（A4 約 297mm − 邊距） */
          .cover-page img, .cover-page.cover-image-only img {
            max-width: 100% !important;
            max-height: 265mm !important;
            width: auto !important;
            height: auto !important;
            object-fit: contain !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            outline: none !important;
          }

          /* ── 2026-05-01 window.print() 本地另存 PDF 路径 ──
             隐藏所有标 data-pdf-exclude="true" 的工具条 / chrome（reading mode
             顶部 sticky 导航 + TemplateStripBanner 等），保证打印产物只剩封面
             hero + 报告正文。强制白底避免奶油渐变背景被印成大色块。
             已废弃的云端 puppeteer 路径也用同一属性剔除元素，规则在两条路径
             下都生效，单一来源不需要双重维护。 */
          [data-pdf-exclude="true"] {
            display: none !important;
          }
          /* Sonner 掛在 body，若未剔除則 fixed toast 會在 Chromium page.pdf() 每頁重複出現 */
          [data-sonner-toaster],
          [data-sonner-toast],
          li[data-sonner-toast] {
            display: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          [data-myreports-read-layout] {
            padding: 0 !important;
            max-width: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 标题渲染

function Heading({ block, colors }: { block: Extract<Block, { kind: "heading" }>; colors: ColorPalette }) {
  const { level, text } = block;
  const stripStars = (s: string) => s.replace(/^\*+|\*+$/g, "").replace(/\*\*/g, "");
  const cleanText = stripStars(text);

  if (level === 1) {
    return (
      <div style={{ margin: "36px 0 22px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 24px",
            borderRadius: 14,
            background: colors.h1Gradient,
            boxShadow: `0 10px 26px ${colors.gold}40`,
            border: `1px solid ${colors.goldLight}80`,
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.20)",
              border: "1.5px solid rgba(255,255,255,0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 900,
              fontSize: 15,
              letterSpacing: "0.05em",
            }}
          >
            ★
          </span>
          <h1
            style={{
              margin: 0,
              color: "#fff",
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: "0.04em",
              textShadow: "0 2px 6px rgba(0,0,0,0.30)",
            }}
          >
            {renderInline(cleanText, colors)}
          </h1>
        </div>
      </div>
    );
  }

  if (level === 2) {
    return (
      <h2
        style={{
          margin: "30px 0 14px",
          paddingLeft: 14,
          borderLeft: `5px solid ${colors.gold}`,
          color: colors.goldDeep,
          fontSize: 21,
          fontWeight: 900,
          letterSpacing: "0.02em",
          background: `linear-gradient(90deg, ${colors.goldLight}1f, transparent)`,
          padding: "8px 0 8px 14px",
          borderRadius: "0 8px 8px 0",
        }}
      >
        {renderInline(cleanText, colors)}
      </h2>
    );
  }

  if (level === 3) {
    return (
      <h3
        style={{
          margin: "22px 0 10px",
          color: colors.goldDeep,
          fontSize: 17,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 18,
            borderRadius: 3,
            background: `linear-gradient(180deg,${colors.goldLight},${colors.goldDeep})`,
          }}
        />
        {renderInline(cleanText, colors)}
      </h3>
    );
  }

  return (
    <h4 style={{ margin: "16px 0 8px", color: colors.gold, fontSize: 15, fontWeight: 700 }}>
      {renderInline(cleanText, colors)}
    </h4>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 占位导出（向后兼容旧的 ReportColors 命名）
export const ReportColors = CAPPUCCINO;
export const SpringMintColors = THEME_PALETTES["spring-mint"];
