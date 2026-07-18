/**
 * 动效 PPT · 方案 A：GPT-5.6 Sol 生成页面清单 + 图表数据；前端仍用代码画 SVG。
 */
import {
  HTML_PPT_STYLES,
  normalizeHtmlPptPages,
  type HtmlPptPage,
  type HtmlPptStyleId,
  type HtmlPptVizKind,
} from "./htmlPptMaker.js";

export const HTML_PPT_OUTLINE_CAPACITY_MESSAGE = "算力紧张，请稍后再试" as const;

export type HtmlPptOutlineLlmInput = {
  title: string;
  purposeZh?: string;
  pageCount: number;
  styleId: HtmlPptStyleId;
  /** 用户补充背景 / 数据口径 / 受众 */
  briefZh?: string;
};

export type HtmlPptOutlineLlmResult = {
  deckTitle: string;
  summary: string;
  pages: HtmlPptPage[];
};

const VIZ_OK = new Set<HtmlPptVizKind>(["cover", "ring", "bars", "columns", "steps", "cards", "line"]);

export function buildHtmlPptOutlineSystemPrompt(): string {
  return `你是 mvstudiopro「动效PPT」内容策划，用 **GPT-5.6 Sol** 产出可直接投屏的中文演示大纲。
图表由前端 SVG 绘制，你只负责**高信息密度文案 + 可量化 series**，禁止空泛正确废话。

硬性要求：
1. 紧扣用户主题/用途/补充背景；禁止无关行业模板套话。
2. 每页一个主判断；标题短而锋利；bullets 写具体结论（可含数字、对比、动作）。
3. 至少一半页面必须带 series（2–6 项，value 为 0–100 相对强度或占比），便于多色条形/柱状/环形图。
4. viz 只能是：cover | ring | bars | columns | steps | cards | line。
5. 封面用 cover；目录/路径用 steps；含 %/完成度用 ring；对比/结构用 columns 或 bars；走势/热度用 line；3–4 个并列指标用 cards。
6. 至少一页 bars（多色排名条）+ 一页 ring 或 line，保证有「图表动效」而不只是文字。
7. 语气像趋势洞察看板：高亮对比、可执行下一步，不是百科简介。
8. 只输出 JSON（json_object），不要 Markdown 围栏。

JSON schema:
{
  "deckTitle": "演示总标题",
  "summary": "一句话说明本套 PPT 主叙事",
  "pages": [
    {
      "title": "页标题",
      "subtitle": "可选副标",
      "kpi": "可选大数字如 72% / 3× / GO",
      "note": "可选脚注",
      "bullets": ["要点1","要点2"],
      "viz": "bars",
      "series": [{"label":"短标签","value":72}]
    }
  ]
}`;
}

export function buildHtmlPptOutlineUserPrompt(input: HtmlPptOutlineLlmInput): string {
  const n = Math.max(3, Math.min(16, Math.floor(input.pageCount || 8)));
  const styleId = input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research";
  const style = HTML_PPT_STYLES[styleId as HtmlPptStyleId];
  const title = String(input.title || "").trim().slice(0, 80);
  const purpose = String(input.purposeZh || "汇报").trim().slice(0, 80);
  const brief = String(input.briefZh || "").trim().slice(0, 4000);
  return [
    `【主题】${title}`,
    `【用途】${purpose}`,
    `【页数】必须正好 ${n} 页（含封面与收束页）`,
    `【风格】${styleId} · ${style.labelZh}（${style.whenZh}）`,
    brief ? `【补充背景/数据/受众】\n${brief}` : "【补充背景】无；请基于主题做合理、具体、可投屏的专业推断，并标明是推演量级。",
    "请输出 pages 数组，长度严格等于页数。",
  ].join("\n");
}

export function parseHtmlPptOutlineJson(
  raw: string,
  opts?: { pageCount?: number },
): HtmlPptOutlineLlmResult {
  const trimmed = String(raw || "").trim();
  if (!trimmed || /^an error occurred/i.test(trimmed)) {
    throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }

  let parsed: Record<string, unknown>;
  try {
    const jsonStr = trimmed.includes("{")
      ? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)
      : trimmed;
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }

  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const mapped: HtmlPptPage[] = rawPages.map((row) => {
    const r = (row || {}) as Record<string, unknown>;
    const vizRaw = String(r.viz || "").trim() as HtmlPptVizKind;
    const series = Array.isArray(r.series)
      ? r.series
          .map((s) => {
            const x = (s || {}) as Record<string, unknown>;
            return {
              label: String(x.label || "").trim().slice(0, 24),
              value: Math.max(0, Math.min(100, Number(x.value) || 0)),
            };
          })
          .filter((s) => s.label)
          .slice(0, 8)
      : undefined;
    return {
      title: String(r.title || "").trim(),
      subtitle: r.subtitle ? String(r.subtitle).trim() : undefined,
      kpi: r.kpi ? String(r.kpi).trim() : undefined,
      note: r.note ? String(r.note).trim() : undefined,
      bullets: Array.isArray(r.bullets)
        ? r.bullets.map((b) => String(b || "").trim()).filter(Boolean).slice(0, 8)
        : undefined,
      viz: VIZ_OK.has(vizRaw) ? vizRaw : undefined,
      series,
    };
  });

  let pages = normalizeHtmlPptPages(mapped);
  const want = Math.max(3, Math.min(16, Math.floor(opts?.pageCount || pages.length || 8)));
  if (pages.length > want) pages = pages.slice(0, want);
  if (pages.length < 3) {
    throw new Error("模型返回页数不足，请重试");
  }
  // 保证封面/收束有 viz
  if (pages[0] && !pages[0].viz) pages[0] = { ...pages[0], viz: "cover" };
  const last = pages[pages.length - 1];
  if (last && !last.viz) pages[pages.length - 1] = { ...last, viz: "steps" };

  return {
    deckTitle: String(parsed.deckTitle || pages[0]?.title || "动效PPT").trim().slice(0, 80),
    summary: String(parsed.summary || "").trim().slice(0, 200),
    pages,
  };
}
