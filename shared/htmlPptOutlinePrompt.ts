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

const VIZ_OK = new Set<HtmlPptVizKind>([
  "cover",
  "ring",
  "bars",
  "columns",
  "steps",
  "cards",
  "line",
  "compare",
]);

export function buildHtmlPptOutlineSystemPrompt(): string {
  return `你是 mvstudiopro「动效PPT」首席内容策划，用 **GPT-5.6 Sol** 产出可直接路演投屏的高密度中文演示大纲。
图表由前端 SVG 分步动效绘制，你只负责**可量化、可对比、可讲解**的文案与 series，禁止空泛正确废话。

硬性要求（不过关=失败）：
1. 紧扣用户主题/用途/补充背景里的数字与口径；禁止无关行业模板套话。补充背景有具体数字时，**必须原样或近似写入 series/kpi/note**，不得改成 0–100 假占比而丢掉量级（如 168亿、6万部、181倍）。
2. 每页一个主判断；标题短而锋利；bullets ≥3 条且含数字/对比/动作；subtitle 写清口径或时间窗。
3. **≥70% 页面必须带 series**（每页 3–8 项）。value 可以是：
   - 绝对量级（168、244、700、181…）→ 前端会按页内 max 归一条宽；
   - 或 0–100 占比/强度。
   label 用短中文（≤12 字），可含单位词如「亿元」「万部」「倍」。
4. viz 只能是：cover | ring | bars | columns | steps | cards | line | compare。
5. 版式分工：
   - 封面 cover；目录/路径/入局 steps；
   - 结构占比 columns 或 bars；年份/区域/模式对照用 **compare**（series 前半=左栏，后半=右栏；bullets[0]/[1] 作左右栏标题）；
   - 走势/预测 line；完成度/渗透 ring；3–4 个并列 KPI cards。
6. **最少同时包含**：1 页 bars + 1 页 columns 或 compare + 1 页 line + 1 页 ring。禁止「全文 steps/纯 bullets」。
7. 复杂比较必须拆页可视化，例如：品类占比、规模预测、国内vs海外、付费vs免费、风险权重——各用独立图表页，不要挤在一段文字里。
8. note 写数据来源或「推演量级/公开研报口径」；kpi 用真人能念的大数字（168亿 / 45% / 181×）。
9. 语气像买方尽调看板：对比、拐点、可执行下一步。
10. 只输出 JSON（json_object），不要 Markdown 围栏。

JSON schema:
{
  "deckTitle": "演示总标题",
  "summary": "一句话主叙事（含核心数字）",
  "pages": [
    {
      "title": "页标题",
      "subtitle": "口径/时间窗",
      "kpi": "168亿",
      "note": "来源或推演说明",
      "bullets": ["要点1（含数字）","要点2","要点3"],
      "viz": "bars",
      "series": [{"label":"沙雕漫","value":44},{"label":"小说漫","value":26}]
    }
  ]
}`;
}

/** 漫剧/短剧市场主题：强制覆盖讲解槽位（与默认 brief、本地样张对齐） */
function isManhuaMarketTopic(title: string, brief: string): boolean {
  const t = `${title}\n${brief}`;
  return /漫剧|短剧|AIGC|仿真人|DataEye|红果|微短剧/.test(t);
}

function manhuaMarketSlotBrief(pageCount: number): string {
  const slots = [
    "封面（cover）",
    "议程/五件事（steps）",
    "当前市场规模（cards，含 168 亿等口径）",
    "2026 预测走势（line，含 243.6/45%）",
    "品类供给占比（bars）",
    "流量/渗透（ring，含 35%/×181）",
    "发展历史四阶（steps）",
    "新手入局路径（steps）",
    "常见坑/风险权重（bars）",
    "国内平台格局（columns）",
    "国内 vs 出海对照（compare）",
    "政策与平台规则（steps）",
    "结论与下一步（steps）",
  ];
  const pick = pageCount >= 13 ? slots : slots.slice(0, Math.max(5, pageCount));
  return [
    "【必覆盖槽位｜顺序可微调但主题不可缺】",
    ...pick.map((s, i) => `${i + 1}. ${s}`),
    "全稿须同时含 bars +（columns 或 compare）+ line + ring；复杂比较禁止纯文字页。",
  ].join("\n");
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
    `【页数】必须正好 ${n} 页（含封面与收束页）；少一页即失败`,
    `【风格】${styleId} · ${style.labelZh}（${style.whenZh}）`,
    brief
      ? `【补充背景/数据/受众】\n${brief}`
      : "【补充背景】无；请基于主题做合理、具体、可投屏的专业推断，关键数字在 note 标明「推演量级」。",
    isManhuaMarketTopic(title, brief) ? manhuaMarketSlotBrief(n) : "",
    "图表纪律：复杂比较必须进 series + 选对 viz（bars/columns/compare/line/ring），禁止只用文字罗列。",
    "图表页仍须给 ≥3 条 bullets（讲解口播点）；前端会在图表动效后分步显示。",
    "请输出 pages 数组，长度严格等于页数。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 从被截断的模型输出里尽量捞出完整 page 对象 */
function salvageTruncatedOutlineJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const body = raw.slice(start);
  const pagesIdx = body.search(/"pages"\s*:\s*\[/);
  if (pagesIdx < 0) return null;
  const arrStart = body.indexOf("[", pagesIdx);
  if (arrStart < 0) return null;
  const pages: unknown[] = [];
  let i = arrStart + 1;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i]!)) i++;
    if (body[i] === "]") break;
    if (body[i] !== "{") break;
    let depth = 0;
    let j = i;
    let inStr = false;
    let esc = false;
    for (; j < body.length; j++) {
      const ch = body[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    if (depth !== 0) break;
    try {
      pages.push(JSON.parse(body.slice(i, j)));
    } catch {
      break;
    }
    i = j;
  }
  if (pages.length < 3) return null;
  const titleMatch = body.match(/"deckTitle"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const summaryMatch = body.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  return {
    deckTitle: titleMatch?.[1]?.replace(/\\"/g, '"') || "",
    summary: summaryMatch?.[1]?.replace(/\\"/g, '"') || "",
    pages,
  };
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
    // 尝试从截断 JSON 抢救已完成的 pages 对象
    const salvaged = salvageTruncatedOutlineJson(trimmed);
    if (!salvaged) throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
    parsed = salvaged;
  }

  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const mapped: HtmlPptPage[] = rawPages.map((row) => {
    const r = (row || {}) as Record<string, unknown>;
    const vizRaw = String(r.viz || "").trim() as HtmlPptVizKind;
    const series = Array.isArray(r.series)
      ? r.series
          .map((s) => {
            const x = (s || {}) as Record<string, unknown>;
            const n = Number(x.value);
            return {
              label: String(x.label || "").trim().slice(0, 28),
              value: Number.isFinite(n) && n >= 0 ? Math.min(1_000_000, n) : 0,
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
  if (pages.length < want) {
    throw new Error(`模型返回页数不足（${pages.length}/${want}），请重试`);
  }
  if (pages[0] && !pages[0].viz) pages[0] = { ...pages[0], viz: "cover" };
  const last = pages[pages.length - 1];
  if (last && !last.viz) pages[pages.length - 1] = { ...last, viz: "steps" };

  return {
    deckTitle: String(parsed.deckTitle || pages[0]?.title || "动效PPT").trim().slice(0, 80),
    summary: String(parsed.summary || "").trim().slice(0, 240),
    pages,
  };
}
