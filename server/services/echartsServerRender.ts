/**
 * 服务端 ECharts 工具：把 markdown 数值表格转成可交互图表挂载点。
 *
 * 历史背景：
 *   原本这里也提供 SSR → SVG 字符串的能力，专给 PDF 服务端渲染路径用
 *   （`pdfTemplate.ts → marked.parse → puppeteer`）。PR pdf-v2-platformpage-mode
 *   把战略 PDF 切到客户端 DOM 快照模式后，server-side SVG 渲染整段路径作废，
 *   `injectChartSvgsIntoMarkdown` / `renderEChartsToSvg` 已删除。
 *
 * 当前职责（仅给 HTML 交互导出 `htmlReportTemplate.ts` 用）：
 *   1. 扫描 markdown 数值表格，推导出 bar / line / radar 图谱 spec
 *   2. 把每个数值表格之后注入一个 `<div class="echart-mount">` 占位 div +
 *      ECharts option JSON，前端内联的 echarts.min.js 在浏览器里 setOption 渲染。
 */

// ─── 调色板（与 client / htmlReportTemplate 主题色对齐） ─────────────────────

export type EChartsTheme =
  | "spring-mint"
  | "neon-tech"
  | "sunset-coral"
  | "ocean-fresh"
  | "business-bright";

interface ChartPalette {
  text: string;
  axis: string;
  grid: string;
  bg: string;
  series: string[];
}

const PALETTES: Record<EChartsTheme, ChartPalette> = {
  "spring-mint": {
    text: "#0F172A",
    axis: "#475569",
    grid: "rgba(16,185,129,0.16)",
    bg: "#FFFFFF",
    series: ["#10B981", "#FB7185", "#06B6D4", "#F59E0B", "#8B5CF6", "#047857"],
  },
  "neon-tech": {
    text: "#1E1B4B",
    axis: "#6B7280",
    grid: "rgba(124,58,237,0.18)",
    bg: "#FFFFFF",
    series: ["#7C3AED", "#06B6D4", "#EC4899", "#3B82F6", "#F59E0B", "#5B21B6"],
  },
  "sunset-coral": {
    text: "#3C1361",
    axis: "#7C5C8B",
    grid: "rgba(139,92,246,0.18)",
    bg: "#FFFFFF",
    series: ["#8B5CF6", "#FB923C", "#F472B6", "#3B82F6", "#10B981", "#6D28D9"],
  },
  "ocean-fresh": {
    text: "#0C1A3D",
    axis: "#475569",
    grid: "rgba(37,99,235,0.18)",
    bg: "#FFFFFF",
    series: ["#2563EB", "#FACC15", "#0EA5E9", "#10B981", "#F472B6", "#1E40AF"],
  },
  "business-bright": {
    text: "#0F1B2D",
    axis: "#55657A",
    grid: "rgba(31,58,95,0.18)",
    bg: "#FFFFFF",
    series: ["#1F3A5F", "#C9A858", "#0EA5E9", "#15803D", "#B6364C", "#162B47"],
  },
};

function paletteFor(theme?: EChartsTheme): ChartPalette {
  if (theme && PALETTES[theme]) return PALETTES[theme];
  return PALETTES["spring-mint"];
}

// ─── 表格 → 图表选项（与 ReportRenderer.deriveChartFromTable 1:1 对齐） ─────

export interface DerivedChartSpec {
  type: "bar" | "line" | "radar";
  data: Array<Record<string, unknown>>;
  numericKeys: string[];
  labelKey: string;
}

function parseNumber(cell: string): number | null {
  if (!cell) return null;
  const s = String(cell).replace(/<br\s*\/?>/gi, " ");
  const m = s.match(/-?\d[\d,，.]*/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/[,，]/g, ""));
  if (Number.isNaN(n)) return null;
  if (/亿/.test(s)) return n * 1e8;
  if (/万/.test(s)) return n * 1e4;
  if (/千/.test(s)) return n * 1000;
  return n;
}

/**
 * 从 markdown 表格 headers/rows 推导图表 spec。
 * 算法与 client/src/components/ReportRenderer.tsx 的 deriveChartFromTable 一致：
 *   - 第 1 列做 label，其余列若 ≥60% 为数值则视为数值列
 *   - 命中 /雷达|维度|能力|评分|短板|画像|象限/ → radar
 *   - 命中 /年|月|周|日|阶段|期|Day|Q[1-4]|2024|2025|2026/ → line
 *   - 否则 bar
 *   - 数值列 0 列时返回 null（不出图）
 */
export function deriveChartSpecFromTable(headers: string[], rows: string[][]): DerivedChartSpec | null {
  if (headers.length < 2 || rows.length < 2) return null;
  const labelKey = headers[0];
  const numericKeys: string[] = [];
  for (let c = 1; c < headers.length; c++) {
    const colVals = rows.map((r) => parseNumber(r[c] || ""));
    const nums = colVals.filter((v): v is number => v !== null);
    if (nums.length >= Math.max(2, Math.floor(rows.length * 0.6))) {
      numericKeys.push(headers[c]);
    }
  }
  if (numericKeys.length === 0) return null;

  const data: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const item: Record<string, unknown> = { [labelKey]: r[0] || "" };
    let hasAny = false;
    headers.slice(1).forEach((h, idx) => {
      if (numericKeys.includes(h)) {
        const v = parseNumber(r[idx + 1] || "");
        item[h] = v ?? 0;
        if (v !== null) hasAny = true;
      }
    });
    if (hasAny) data.push(item);
  }
  if (data.length < 2) return null;

  const headerStr = headers.join(" ");
  const labelStr = data.map((d) => String(d[labelKey])).join(" ");
  let type: DerivedChartSpec["type"] = "bar";
  if (/雷达|维度|能力|评分|短板|画像|象限/.test(headerStr + labelStr)) type = "radar";
  else if (/年|月|周|日|阶段|期|Day|Q[1-4]|2024|2025|2026/.test(labelStr)) type = "line";

  return { type, data, numericKeys, labelKey };
}

/** 把 DerivedChartSpec 转成 ECharts option。 */
export function buildEChartsOption(spec: DerivedChartSpec, theme?: EChartsTheme): any {
  const palette = paletteFor(theme);
  const { type, data, numericKeys, labelKey } = spec;
  const labels = data.map((d) => String(d[labelKey] ?? ""));

  const baseTextStyle = {
    color: palette.text,
    fontFamily: "Noto Sans CJK SC, PingFang SC, system-ui, sans-serif",
    fontSize: 12,
  };

  if (type === "radar") {
    const indicator = labels.map((name) => {
      let max = 0;
      for (const key of numericKeys) {
        for (const row of data) {
          const v = Number(row[key] ?? 0);
          if (v > max) max = v;
        }
      }
      return { name, max: max > 0 ? Math.ceil(max * 1.1) : 100 };
    });
    return {
      backgroundColor: palette.bg,
      animation: false,
      color: palette.series,
      textStyle: baseTextStyle,
      legend: { top: 8, textStyle: baseTextStyle, type: "scroll", padding: [4, 8] },
      tooltip: { trigger: "item" },
      radar: {
        indicator,
        radius: "50%",
        center: ["50%", "55%"],
        splitLine: { lineStyle: { color: palette.grid } },
        splitArea: { areaStyle: { color: ["rgba(255,255,255,0.6)", "rgba(255,255,255,0.3)"] } },
        axisLine: { lineStyle: { color: palette.grid } },
        axisName: { color: palette.text, fontSize: 10, lineHeight: 14 },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.28 },
          data: numericKeys.map((key) => ({
            name: key,
            value: data.map((row) => Number(row[key] ?? 0)),
          })),
        },
      ],
    };
  }

  // bar / line 共用基础轴 + grid
  const xAxis = {
    type: "category",
    data: labels,
    axisLabel: {
      color: palette.axis,
      fontSize: 11,
      hideOverlap: true,
      rotate: labels.some((s) => s.length > 6) ? 25 : 0,
    },
    axisLine: { lineStyle: { color: palette.grid } },
    axisTick: { lineStyle: { color: palette.grid } },
  };
  const yAxis = {
    type: "value",
    axisLabel: { color: palette.axis, fontSize: 11 },
    splitLine: { lineStyle: { color: palette.grid } },
    axisLine: { show: false },
  };

  const baseSeries = numericKeys.map((key, idx) => {
    const color = palette.series[idx % palette.series.length];
    if (type === "line") {
      return {
        name: key,
        type: "line" as const,
        data: data.map((row) => Number(row[key] ?? 0)),
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2.5, color },
        itemStyle: { color },
        emphasis: { focus: "series" },
      };
    }
    return {
      name: key,
      type: "bar" as const,
      data: data.map((row) => Number(row[key] ?? 0)),
      itemStyle: { color, borderRadius: [6, 6, 0, 0] },
      barMaxWidth: 36,
      emphasis: { focus: "series" },
    };
  });

  return {
    backgroundColor: palette.bg,
    animation: false,
    color: palette.series,
    textStyle: baseTextStyle,
    grid: { left: 56, right: 24, top: 44, bottom: 60, containLabel: true },
    legend: { top: 8, textStyle: baseTextStyle, type: "scroll", padding: [4, 8] },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis,
    yAxis,
    series: baseSeries,
  };
}

function splitTableRow(line: string): string[] {
  let raw = line.trim();
  if (raw.startsWith("|")) raw = raw.slice(1);
  if (raw.endsWith("|")) raw = raw.slice(0, -1);
  return raw.split("|").map((c) => {
    // Strip markdown bold/italic before processing for charts
    return c.trim().replace(/[*_~`]/g, "");
  });
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── 给 HTML 交互导出用：仅返回 spec / option 列表，不渲染 SVG ──────────────
//
// HTML 交互导出会内联 echarts.min.js，希望客户端用 echarts.init(div) +
// setOption(option) 跑出可交互图。所以我们提供一个"扫描 + 替换占位 div"的工具。

export interface ExtractedChart {
  index: number; // 1-based，用于 caption
  type: "bar" | "line" | "radar";
  option: any;
}

/**
 * 用占位 div 替换表格后注入位置：
 *   `<div class="echart-mount" id="echart-N" data-chart-option='{...JSON...}'></div>`
 * 客户端 script 会扫描所有 .echart-mount，用 echarts.init + setOption 渲染。
 */
export function injectChartMountsIntoMarkdown(
  markdown: string,
  opts?: { theme?: EChartsTheme },
): { markdown: string; charts: ExtractedChart[] } {
  if (!markdown || !markdown.trim()) return { markdown, charts: [] };
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const charts: ExtractedChart[] = [];
  let i = 0;
  let chartIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      /^\|.+\|$/.test(trimmed) &&
      i + 1 < lines.length &&
      /^\|?\s*:?-{2,}.*$/.test(lines[i + 1].trim())
    ) {
      const headers = splitTableRow(trimmed);
      out.push(line);
      out.push(lines[i + 1]);
      i += 2;
      const rowLines: string[] = [];
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rowLines.push(lines[i]);
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      out.push(...rowLines);

      const spec = deriveChartSpecFromTable(headers, rows);
      if (spec) {
        chartIdx += 1;
        const option = buildEChartsOption(spec, opts?.theme);
        charts.push({ index: chartIdx, type: spec.type, option });
        const captionType = spec.type === "radar" ? "雷达图" : spec.type === "line" ? "折线图" : "柱状图";
        const caption = `图 ${chartIdx} · 数据可视化（${captionType}） · 根据上方表格自动生成`;
        out.push("");
        out.push(`<figure class="chart-figure" data-chart-type="${spec.type}">`);
        out.push(
          `<div class="echart-mount" id="echart-${chartIdx}" style="width:100%;height:${
            spec.type === "radar" ? 460 : 380
          }px;"></div>`,
        );
        out.push(`<figcaption>${escapeHtml(caption)}</figcaption>`);
        out.push(`</figure>`);
        out.push("");
      }
      continue;
    }
    out.push(line);
    i++;
  }

  return { markdown: out.join("\n"), charts };
}
