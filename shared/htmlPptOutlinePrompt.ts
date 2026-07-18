/**
 * 动效 PPT · 方案 A：Sol 生成页面清单 + 图表数据；Terra 补主题/润色标题；前端仍用代码画 SVG。
 */
import {
  HTML_PPT_STYLES,
  normalizeHtmlPptImageMotion,
  normalizeHtmlPptPages,
  type HtmlPptPage,
  type HtmlPptStyleId,
  type HtmlPptTheme,
  type HtmlPptVizKind,
} from "./htmlPptMaker.js";
import { PLATFORM_HTML_PPT_PAGE_MAX, PLATFORM_HTML_PPT_PAGE_MIN } from "./plans.js";

export const HTML_PPT_OUTLINE_CAPACITY_MESSAGE = "算力紧张，请稍后再试" as const;

export type HtmlPptOutlineLlmInput = {
  title: string;
  purposeZh?: string;
  pageCount: number;
  styleId: HtmlPptStyleId;
  /** 用户补充背景 / 数据口径 / 受众 */
  briefZh?: string;
  /** 用户已确认的大纲主题（含自填 + Terra 补全） */
  confirmedThemes?: HtmlPptTheme[];
};

export type HtmlPptOutlineLlmResult = {
  deckTitle: string;
  summary: string;
  pages: HtmlPptPage[];
};

export type HtmlPptThemeSuggestInput = {
  title: string;
  purposeZh?: string;
  briefZh?: string;
  userThemes: string[];
};

export type HtmlPptThemeSuggestResult = {
  polishedTitle: string;
  suggestedThemes: HtmlPptTheme[];
};

export type HtmlPptPagePatchInput = {
  title: string;
  purposeZh?: string;
  briefZh?: string;
  styleId: HtmlPptStyleId;
  page: HtmlPptPage;
  pageIndex: number;
  totalPages: number;
  patchNote: string;
  confirmedThemes?: HtmlPptTheme[];
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
  "table",
  "scene_cards",
  "sentiment",
  "hub",
]);

function clampPageCount(n: unknown): number {
  return Math.max(
    PLATFORM_HTML_PPT_PAGE_MIN,
    Math.min(PLATFORM_HTML_PPT_PAGE_MAX, Math.floor(Number(n) || PLATFORM_HTML_PPT_PAGE_MIN)),
  );
}

export function buildHtmlPptThemeSuggestSystemPrompt(): string {
  return `你是 mvstudiopro「动效PPT」主题策划顾问，负责在用户已有主题基础上**补全 3–4 个互补主题**，并**润色演示总标题**。
只输出 JSON（json_object），不要 Markdown 围栏。

要求：
1. 不重复用户已填主题；新主题短而锋利（≤16 字），覆盖不同叙事切面（现状/对比/风险/路径/预测/案例等）。
2. 若用户选了「前景/预测/展望」类主题，补主题时须保留或强化「未来预测」维度。
3. polishedTitle：在原标题基础上更投屏友好（≤40 字），勿改核心语义。
4. 每个 suggestedThemes 项含 id（英文 snake_case，≤24 字）与 title（中文主题名）。
5. suggestedThemes 长度 3–4 条。

JSON schema:
{
  "polishedTitle": "润色后的演示标题",
  "suggestedThemes": [
    { "id": "market_scale", "title": "市场规模与增速" }
  ]
}`;
}

export function buildHtmlPptThemeSuggestUserPrompt(input: HtmlPptThemeSuggestInput): string {
  const title = String(input.title || "").trim().slice(0, 80);
  const purpose = String(input.purposeZh || "汇报").trim().slice(0, 80);
  const brief = String(input.briefZh || "").trim().slice(0, 2000);
  const userThemes = (input.userThemes || [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  return [
    `【原标题】${title}`,
    `【用途】${purpose}`,
    `【用户已填主题（勿重复）】${userThemes.length ? userThemes.join("；") : "（无）"}`,
    brief ? `【补充背景】\n${brief}` : "【补充背景】无；请基于标题与已有主题做专业推断。",
    "请补 3–4 个互补主题，并给出 polishedTitle。",
  ].join("\n");
}

export function parseHtmlPptThemeSuggestJson(raw: string): HtmlPptThemeSuggestResult {
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
  const rawThemes = Array.isArray(parsed.suggestedThemes) ? parsed.suggestedThemes : [];
  const suggestedThemes: HtmlPptTheme[] = rawThemes
    .map((row, i) => {
      const r = (row || {}) as Record<string, unknown>;
      const title = String(r.title || "").trim().slice(0, 40);
      const id = String(r.id || `theme_${i + 1}`)
        .trim()
        .slice(0, 40)
        .replace(/\s+/g, "_");
      return title ? { id, title } : null;
    })
    .filter((t): t is HtmlPptTheme => Boolean(t))
    .slice(0, 4);
  if (suggestedThemes.length < 3) {
    throw new Error("主题补全不足，请重试");
  }
  return {
    polishedTitle: String(parsed.polishedTitle || "").trim().slice(0, 80),
    suggestedThemes,
  };
}

export function buildHtmlPptOutlineSystemPrompt(): string {
  return `你是 mvstudiopro「动效PPT」首席内容策划，产出可直接路演投屏的高密度中文演示大纲。
图表由前端 SVG 分步动效绘制，你只负责**可量化、可对比、可讲解**的文案与 series，禁止空泛正确废话。

硬性要求（不过关=失败）：
1. 紧扣用户主题/用途/补充背景里的数字与口径；禁止无关行业模板套话。补充背景有具体数字时，**必须原样或近似写入 series/kpi/note**，不得改成 0–100 假占比而丢掉量级（如 168亿、6万部、181倍）。
2. **页序**：pages[0] 必须是封面（viz=cover）；pages[1] 必须是目录/议程（viz=steps 或 hub），逐条列出 confirmedThemes 的**中文 themeTitle**（写在 series.label / bullets）；后续页按主题展开。每页 JSON **必须**带 themeId/themeTitle 元数据，但 **themeId 禁止出现在任何可见文案**（title/subtitle/kpi/note/bullets/highlight/series.label），禁止写成 [u_1_xxx]、growth_forecast 市场规模 这类泄漏。
3. 若 confirmedThemes 含「前景/预测/展望/2026/2030」等未来向主题，**必须至少 1 页 line 或 cards 呈现预测走势/区间**。
4. 每页一个主判断；标题短而锋利；bullets ≥3 条且含数字/对比/动作；subtitle 写清口径或时间窗。
5. **≥70% 页面必须带 series**（每页 3–8 项）。value 可以是绝对量级或 0–100 占比/强度；label 用短中文（≤12 字）。
6. viz 只能是：cover | ring | bars | columns | steps | cards | line | compare | table | scene_cards | sentiment | hub。
   - table：多维对照表；scene_cards：场景卡片；sentiment：情绪/舆情分布；hub：主题枢纽/目录辐射。
7. 版式分工：封面 cover；目录/路径 steps 或 hub；结构占比 columns/bars；对照 compare；走势/预测 line；完成度 ring；并列 KPI cards。
8. **最少同时包含**：1 页 bars + 1 页 columns 或 compare + 1 页 line + 1 页 ring。禁止「全文 steps/纯 bullets」。
9. highlight[]：每页 0–3 条需前端高亮闪烁的关键短语（≤20 字，可与 bullets 重叠）。
10. note 写数据来源或「推演量级/公开研报口径」；kpi 用真人能念的大数字。
11. 语气像买方尽调看板：对比、拐点、可执行下一步。
12. **imageMotion（可选）**：仅封面/数据高潮等「值得插图讲解」的关键页可写 3–5 拍；pose 只能是 hero | dock_right | dock_left | dock_bottom。须从 hero@0 起，中间可穿插 dock_* 与再次 hero（强调图细节），收束到 dock_right 或 dock_bottom。多数页不要写（缺省由代码用两拍：hero→dock_right）。
13. 只输出 JSON（json_object），不要 Markdown 围栏。

JSON schema:
{
  "deckTitle": "演示总标题",
  "summary": "一句话主叙事（含核心数字）",
  "pages": [
    {
      "title": "页标题",
      "subtitle": "口径/时间窗",
      "themeId": "market_scale",
      "themeTitle": "市场规模",
      "kpi": "168亿",
      "note": "来源或推演说明",
      "bullets": ["要点1（含数字）","要点2","要点3"],
      "highlight": ["关键短语"],
      "viz": "bars",
      "series": [{"label":"沙雕漫","value":44},{"label":"小说漫","value":26}],
      "imageMotion": [
        {"at":0,"pose":"hero"},
        {"at":1,"pose":"dock_right"},
        {"at":3,"pose":"hero"},
        {"at":4,"pose":"dock_left"}
      ]
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
    "议程/五件事（steps 或 hub，挂靠 confirmedThemes）",
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
  const pick = pageCount >= 13 ? slots : slots.slice(0, Math.max(PLATFORM_HTML_PPT_PAGE_MIN, pageCount));
  return [
    "【必覆盖槽位｜顺序可微调但主题不可缺】",
    ...pick.map((s, i) => `${i + 1}. ${s}`),
    "全稿须同时含 bars +（columns 或 compare）+ line + ring；复杂比较禁止纯文字页。",
  ].join("\n");
}

function formatConfirmedThemes(themes?: HtmlPptTheme[]): string {
  if (!themes?.length) return "";
  return [
    "【已确认大纲主题——pages[1] 目录须全覆盖，后续页逐主题展开】",
    "说明：方括号内是 JSON 元数据 themeId，**投屏文案只写后面的中文标题**。",
    ...themes.map((t, i) => `${i + 1}. themeId=${t.id} → 可见标题「${t.title}」`),
  ].join("\n");
}

export function buildHtmlPptOutlineUserPrompt(input: HtmlPptOutlineLlmInput): string {
  const n = clampPageCount(input.pageCount);
  const styleId = input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research";
  const style = HTML_PPT_STYLES[styleId as HtmlPptStyleId];
  const title = String(input.title || "").trim().slice(0, 80);
  const purpose = String(input.purposeZh || "汇报").trim().slice(0, 80);
  const brief = String(input.briefZh || "").trim().slice(0, 4000);
  const themesBlock = formatConfirmedThemes(input.confirmedThemes);
  return [
    `【主题】${title}`,
    `【用途】${purpose}`,
    `【页数】必须正好 ${n} 页（含封面与收束页）；少一页即失败`,
    `【风格】${styleId} · ${style.labelZh}（${style.whenZh}）`,
    themesBlock,
    brief
      ? `【补充背景/数据/受众】\n${brief}`
      : "【补充背景】无；请基于主题做合理、具体、可投屏的专业推断，关键数字在 note 标明「推演量级」。",
    isManhuaMarketTopic(title, brief) ? manhuaMarketSlotBrief(n) : "",
    themesBlock
      ? "pages[0]=封面(cover)；pages[1]=目录/议程(steps 或 hub)，series/bullets 只写中文 themeTitle；每页 JSON 带 themeId/themeTitle，可见文案禁止出现 themeId。"
      : "",
    "图表纪律：复杂比较必须进 series + 选对 viz（bars/columns/compare/line/ring/table 等），禁止只用文字罗列。",
    "图表页仍须给 ≥3 条 bullets（讲解口播点）；highlight[] 标注 0–3 条需高亮的关键短语。",
    "请输出 pages 数组，长度严格等于页数。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildHtmlPptPagePatchSystemPrompt(): string {
  return `你是 mvstudiopro「动效PPT」单页重修编辑，根据用户 patchNote 重写**一页**演示内容。
保持与全稿主题/风格一致；只输出 JSON（json_object），不要 Markdown 围栏。

要求：
1. 输出单个 page 对象，字段同大纲页：title/subtitle/kpi/note/bullets/viz/series/themeId/themeTitle/highlight，以及可选 imageMotion。
2. viz 只能是：cover | ring | bars | columns | steps | cards | line | compare | table | scene_cards | sentiment | hub。
3. 图表页须 series（3–8 项）+ bullets≥3；highlight 0–3 条。
4. 若 patchNote 要求改数字/口径，须落实进 series/kpi/note。
5. imageMotion：仅当本页值得插图讲解时可写/改写 3–5 拍（pose=hero|dock_right|dock_left|dock_bottom，须含 hero@0）；否则省略，沿用默认两拍。`;
}

export function buildHtmlPptPagePatchUserPrompt(input: HtmlPptPagePatchInput): string {
  const styleId = input.styleId in HTML_PPT_STYLES ? input.styleId : "dark_research";
  const style = HTML_PPT_STYLES[styleId as HtmlPptStyleId];
  const pageJson = JSON.stringify(input.page, null, 0).slice(0, 6000);
  return [
    `【全稿主题】${String(input.title || "").trim().slice(0, 80)}`,
    input.purposeZh ? `【用途】${String(input.purposeZh).trim().slice(0, 80)}` : "",
    input.briefZh ? `【背景】\n${String(input.briefZh).trim().slice(0, 2000)}` : "",
    `【风格】${styleId} · ${style.labelZh}`,
    formatConfirmedThemes(input.confirmedThemes),
    `【页码】第 ${input.pageIndex + 1}/${input.totalPages} 页`,
    `【当前页 JSON】${pageJson}`,
    `【重修说明】${String(input.patchNote || "").trim().slice(0, 800)}`,
    '请输出 {"page":{...}} 单个 page 对象。',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseHtmlPptPagePatchJson(raw: string): HtmlPptPage {
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
  const row = (parsed.page ?? parsed) as Record<string, unknown>;
  const mapped = mapRawPage(row);
  const [page] = normalizeHtmlPptPages([mapped]);
  if (!page?.title) throw new Error("重修页缺少标题，请重试");
  return page;
}

function mapRawPage(r: Record<string, unknown>): HtmlPptPage {
  const vizRaw = String(r.viz || "").trim() as HtmlPptVizKind;
  const series = Array.isArray(r.series)
    ? r.series
        .map((s) => {
          const x = (s || {}) as Record<string, unknown>;
          const n = Number(x.value);
          return {
            label: String(x.label || "").trim().slice(0, 28),
            value: Number.isFinite(n) && n >= 0 ? Math.min(100_000_000, n) : 0,
          };
        })
        .filter((s) => s.label)
        .slice(0, 8)
    : undefined;
  const imageMotion = normalizeHtmlPptImageMotion(r.imageMotion);
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
    themeId: r.themeId ? String(r.themeId).trim().slice(0, 40) : undefined,
    themeTitle: r.themeTitle ? String(r.themeTitle).trim().slice(0, 40) : undefined,
    highlight: Array.isArray(r.highlight)
      ? r.highlight.map((h) => String(h || "").trim()).filter(Boolean).slice(0, 6)
      : undefined,
    imageMotion,
  };
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
  if (pages.length < PLATFORM_HTML_PPT_PAGE_MIN) return null;
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
    const salvaged = salvageTruncatedOutlineJson(trimmed);
    if (!salvaged) throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
    parsed = salvaged;
  }

  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const mapped: HtmlPptPage[] = rawPages.map((row) => mapRawPage((row || {}) as Record<string, unknown>));

  let pages = normalizeHtmlPptPages(mapped);
  const want = clampPageCount(opts?.pageCount || pages.length || PLATFORM_HTML_PPT_PAGE_MIN);
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
