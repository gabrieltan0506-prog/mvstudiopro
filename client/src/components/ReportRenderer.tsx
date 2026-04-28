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

/**
 * 战略战报富文本渲染器
 * - 解析 Markdown：标题、表格、列表、引用、分隔线、加粗、行内代码
 * - 表格统一渲染为奢华黑金风格
 * - 数值型表格自动衍生柱状图 / 折线图 / 雷达图
 * - 标题与关键词高亮配色，提升层次感
 * - 全部样式内联，方便 html-to-image 截图导出
 */

// 卡布奇諾咖啡色系 · 高级商务调色盘
const COLORS = {
  // 牛奶泡沫白 → 卡布奇諾米黄 → 拿铁焦糖
  bg: "#f7ede0",          // 卡布奇諾底色（泡沫米色）
  bgDeep: "#ede0c9",      // 焦糖色系
  panel: "#fffaf0",       // 牛奶泡沫白
  panelAlt: "#f5ecda",    // 浅咖啡霜
  ink: "#2a1c0e",         // 浓缩咖啡黑
  inkSoft: "#4a3621",     // 摩卡棕
  gold: "#a8761b",        // 焦糖金
  goldDeep: "#7a5410",    // 深咖啡金
  goldLight: "#d8a23a",   // 蜂蜜金
  cocoa: "#6b4423",       // 可可棕
  cream: "#faf3e6",       // 奶油白
  rose: "#b6364c",
  emerald: "#1f7a52",
  ocean: "#2160a0",
  amber: "#d8841a",
  divider: "rgba(122,84,16,0.22)",
  cardShadow: "0 6px 28px rgba(74,54,33,0.10), 0 2px 6px rgba(74,54,33,0.06)",
};

const CHART_PALETTE = [
  COLORS.gold,
  COLORS.rose,
  COLORS.ocean,
  COLORS.emerald,
  COLORS.amber,
  COLORS.goldDeep,
];

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

    // 跳过空行
    if (!trimmed) {
      i++;
      continue;
    }

    // 标题
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ kind: "heading", level, text: headingMatch[2] });
      i++;
      continue;
    }

    // 分隔线
    if (/^(---+|===+|\*\*\*+)$/.test(trimmed)) {
      blocks.push({ kind: "divider" });
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    // 嵌入图（数据 URL 或 HTML img 标签）
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(trimmed);
    if (imgMatch) {
      blocks.push({ kind: "image", alt: imgMatch[1], src: imgMatch[2] });
      i++;
      continue;
    }
    if (/^<img\s/i.test(trimmed)) {
      blocks.push({ kind: "html", html: trimmed });
      i++;
      continue;
    }

    // 表格（必须连续两行：表头 | 分隔行）
    if (
      /^\|.+\|$/.test(trimmed) &&
      i + 1 < lines.length &&
      /^\|?\s*:?-{2,}.*$/.test(lines[i + 1].trim())
    ) {
      const headers = splitTableRow(trimmed);
      i += 2; // 跳过分隔行
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      flushList(items, true);
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      flushList(items, false);
      continue;
    }

    // 段落（连续非空行合并）
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
      !/^(---+|===+|\*\*\*+)$/.test(lines[i].trim())
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

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|<br\s*\/?>)/gi);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^<br\s*\/?>$/i.test(p)) return <br key={i} />;
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong
          key={i}
          style={{ color: COLORS.goldDeep, fontWeight: 800, background: "linear-gradient(180deg, transparent 70%, rgba(216,162,58,0.28) 70%)", padding: "0 2px" }}
        >
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} style={{ background: "rgba(168,118,27,0.12)", padding: "1px 6px", borderRadius: 4, color: COLORS.goldDeep, fontSize: 12, fontFamily: "ui-monospace,monospace" }}>
          {p.slice(1, -1)}
        </code>
      );
    return <span key={i}>{p}</span>;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 数值识别 + 自动图表

const NUMERIC_RE = /-?¥?\$?\s*\d[\d,，.]*(?:\s*[%‰万亿千百点天分秒小时年月周日次人元$]+)?/;

function parseNumber(cell: string): number | null {
  if (!cell) return null;
  const s = cell.replace(/<br\s*\/?>/gi, " ");
  const m = s.match(/-?\d[\d,，.]*/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/[,，]/g, ""));
  if (Number.isNaN(n)) return null;
  // 万 / 亿 单位估算（仅用于图表方便对比）
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

  // 选择图表类型：单维度多项目→柱状；含「年/月/周/日/期」→折线；标题含「雷达/能力/维度」→雷达
  const headerStr = headers.join(" ");
  const labelStr = data.map((d) => String(d[labelKey])).join(" ");
  let type: "bar" | "line" | "radar" = "bar";
  if (/雷达|维度|能力|评分|短板|画像|象限/.test(headerStr + labelStr)) type = "radar";
  else if (/年|月|周|日|阶段|期|Day|Q[1-4]|2024|2025|2026/.test(labelStr)) type = "line";

  return { type, data, numericKeys, labelKey };
}

// ───────────────────────────────────────────────────────────────────────────
// 渲染：表格 + 图表

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div
      style={{
        margin: "20px 0",
        borderRadius: 14,
        background: COLORS.panel,
        boxShadow: COLORS.cardShadow,
        border: `1px solid ${COLORS.divider}`,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: COLORS.ink }}>
          <thead>
            <tr style={{ background: "linear-gradient(90deg,#7a5410 0%,#a8761b 50%,#7a5410 100%)" }}>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "12px 14px",
                    color: "#fff7df",
                    fontWeight: 800,
                    fontSize: 13,
                    textAlign: "left",
                    letterSpacing: "0.04em",
                    borderRight: i < headers.length - 1 ? "1px solid rgba(255,247,223,0.18)" : "none",
                  }}
                >
                  {renderInline(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? COLORS.panelAlt : COLORS.panel }}>
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "11px 14px",
                      verticalAlign: "top",
                      borderRight: ci < r.length - 1 ? "1px dashed rgba(180,130,0,0.18)" : "none",
                      borderTop: `1px solid rgba(180,130,0,0.10)`,
                      color: ci === 0 ? COLORS.goldDeep : COLORS.inkSoft,
                      fontWeight: ci === 0 ? 700 : 500,
                      lineHeight: 1.65,
                    }}
                  >
                    {renderInline(cell)}
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

function ChartFromTable({ chart }: { chart: ChartData }) {
  if (!chart.type || !chart.data.length) return null;

  const tooltipStyle = {
    background: "#fffaf0",
    border: `1px solid ${COLORS.gold}`,
    borderRadius: 8,
    boxShadow: COLORS.cardShadow,
    fontSize: 12,
    color: COLORS.ink,
  };

  const commonGrid = (
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,118,27,0.18)" />
  );

  return (
    <div
      style={{
        margin: "12px 0 28px",
        padding: "16px 18px 12px",
        background: COLORS.panel,
        borderRadius: 14,
        border: `1px solid ${COLORS.divider}`,
        boxShadow: COLORS.cardShadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: COLORS.goldDeep, letterSpacing: "0.1em", background: "rgba(168,118,27,0.10)", padding: "3px 10px", borderRadius: 99 }}>
          数据可视化
        </span>
        <span style={{ fontSize: 12, color: COLORS.inkSoft }}>
          根据上方表格自动生成 · 仅展示数值列对比
        </span>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          {chart.type === "bar" ? (
            <BarChart data={chart.data} margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
              {commonGrid}
              <XAxis dataKey={chart.labelKey} tick={{ fill: COLORS.inkSoft, fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fill: COLORS.inkSoft, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: COLORS.ink }} />
              {chart.numericKeys.map((key, idx) => (
                <Bar key={key} dataKey={key} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          ) : chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
              {commonGrid}
              <XAxis dataKey={chart.labelKey} tick={{ fill: COLORS.inkSoft, fontSize: 11 }} />
              <YAxis tick={{ fill: COLORS.inkSoft, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: COLORS.ink }} />
              {chart.numericKeys.map((key, idx) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_PALETTE[idx % CHART_PALETTE.length]}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: CHART_PALETTE[idx % CHART_PALETTE.length] }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          ) : (
            <RadarChart data={chart.data} margin={{ top: 12, right: 24, left: 24, bottom: 12 }}>
              <PolarGrid stroke="rgba(168,118,27,0.30)" />
              <PolarAngleAxis dataKey={chart.labelKey} tick={{ fill: COLORS.ink, fontSize: 11 }} />
              <PolarRadiusAxis tick={{ fill: COLORS.inkSoft, fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: COLORS.ink }} />
              {chart.numericKeys.map((key, idx) => (
                <Radar
                  key={key}
                  name={key}
                  dataKey={key}
                  stroke={CHART_PALETTE[idx % CHART_PALETTE.length]}
                  fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
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
}

export default function ReportRenderer({
  markdown,
  className,
  padding,
  noAutoChart,
}: ReportRendererProps) {
  const blocks = useMemo(() => parseMarkdown(markdown || ""), [markdown]);

  return (
    <div
      className={className}
      data-report-root
      style={{
        background: `linear-gradient(180deg,${COLORS.cream} 0%,${COLORS.bg} 35%,${COLORS.panelAlt} 75%,${COLORS.bg} 100%)`,
        color: COLORS.ink,
        padding: padding ?? "44px 56px",
        borderRadius: 18,
        fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif",
        fontSize: 15.5,
        lineHeight: 1.9,
        boxShadow: COLORS.cardShadow,
        border: `1px solid ${COLORS.divider}`,
      }}
    >
      {/* 装饰：顶部卡布奇諾金边书脊 */}
      <div
        style={{
          height: 6,
          margin: "-44px -56px 30px",
          background: "linear-gradient(90deg,#6b4423 0%,#a8761b 25%,#faf3e6 50%,#a8761b 75%,#6b4423 100%)",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
        }}
      />

      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "heading":
            return <Heading key={idx} block={b} />;
          case "paragraph":
            return (
              <p key={idx} style={{ margin: "10px 0", color: COLORS.inkSoft, fontSize: 15.5, lineHeight: 1.95, textAlign: "justify" }}>
                {renderInline(b.text)}
              </p>
            );
          case "list":
            return b.ordered ? (
              <ol key={idx} style={{ margin: "12px 0 16px 4px", paddingLeft: 24, color: COLORS.inkSoft }}>
                {b.items.map((it, i) => (
                  <li key={i} style={{ margin: "6px 0", lineHeight: 1.85 }}>
                    {renderInline(it)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={idx} style={{ margin: "12px 0 16px 4px", paddingLeft: 22, listStyle: "none", color: COLORS.inkSoft }}>
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
                        background: "linear-gradient(135deg,#d8a23a,#7a5410)",
                      }}
                    />
                    {renderInline(it)}
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
                  borderLeft: `4px solid ${COLORS.gold}`,
                  background: "linear-gradient(90deg, rgba(216,162,58,0.10), rgba(216,162,58,0.02))",
                  borderRadius: 8,
                  color: COLORS.goldDeep,
                  fontStyle: "normal",
                  fontWeight: 600,
                  fontSize: 14.5,
                }}
              >
                <span style={{ marginRight: 8, fontSize: 18 }}>“</span>
                {renderInline(b.text)}
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
                  background: "linear-gradient(90deg, transparent, rgba(168,118,27,0.45), transparent)",
                }}
              />
            );
          case "image":
            return (
              <div key={idx} style={{ margin: "16px 0", textAlign: "center" }}>
                <img src={b.src} alt={b.alt || ""} style={{ maxWidth: "100%", borderRadius: 10, boxShadow: COLORS.cardShadow }} />
              </div>
            );
          case "html":
            return (
              <div key={idx} style={{ margin: "16px 0", textAlign: "center" }} dangerouslySetInnerHTML={{ __html: b.html }} />
            );
          case "table": {
            const chart = noAutoChart ? null : deriveChartFromTable(b.headers, b.rows);
            return (
              <div key={idx}>
                <TableBlock headers={b.headers} rows={b.rows} />
                {chart && chart.type ? <ChartFromTable chart={chart} /> : null}
              </div>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 标题渲染

function Heading({ block }: { block: Extract<Block, { kind: "heading" }> }) {
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
            background: "linear-gradient(90deg,#6b4423 0%,#a8761b 55%,#d8a23a 100%)",
            boxShadow: "0 10px 26px rgba(107,68,35,0.35)",
            border: "1px solid rgba(216,162,58,0.65)",
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(250,243,230,0.20)",
              border: "1.5px solid rgba(250,243,230,0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#faf3e6",
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
              color: "#faf3e6",
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: "0.04em",
              textShadow: "0 2px 6px rgba(42,28,14,0.30)",
            }}
          >
            {renderInline(cleanText)}
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
          borderLeft: `5px solid ${COLORS.gold}`,
          color: COLORS.goldDeep,
          fontSize: 21,
          fontWeight: 900,
          letterSpacing: "0.02em",
          background: "linear-gradient(90deg, rgba(216,162,58,0.12), transparent)",
          padding: "8px 0 8px 14px",
          borderRadius: "0 8px 8px 0",
        }}
      >
        {renderInline(cleanText)}
      </h2>
    );
  }

  if (level === 3) {
    return (
      <h3
        style={{
          margin: "22px 0 10px",
          color: COLORS.goldDeep,
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
            background: "linear-gradient(180deg,#d8a23a,#7a5410)",
          }}
        />
        {renderInline(cleanText)}
      </h3>
    );
  }

  return (
    <h4 style={{ margin: "16px 0 8px", color: COLORS.gold, fontSize: 15, fontWeight: 700 }}>
      {renderInline(cleanText)}
    </h4>
  );
}

// 占位，便于外部组合调用
export { COLORS as ReportColors };
