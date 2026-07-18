/**
 * 动效 PPT 页面清单：Sol 生成文案与图表数据（方案 A）。
 * 主题补全 / 标题润色：Terra（免费）。
 * 长页数分片生成，避免网关/模型截断导致 Unexpected end of JSON。
 * 对外失败文案勿暴露模型名；调用方用异步 job，勿同步硬等。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm";
import {
  getPlatformSkillQaOpenAiModel,
  getPlatformStage2OpenAiModel,
  resolvePlatformSkillQaReasoningEffort,
} from "../config/platformSwitches";
import {
  HTML_PPT_OUTLINE_CAPACITY_MESSAGE,
  buildHtmlPptOutlineSystemPrompt,
  buildHtmlPptOutlineUserPrompt,
  buildHtmlPptPagePatchSystemPrompt,
  buildHtmlPptPagePatchUserPrompt,
  buildHtmlPptThemeSuggestSystemPrompt,
  buildHtmlPptThemeSuggestUserPrompt,
  parseHtmlPptOutlineJson,
  parseHtmlPptPagePatchJson,
  parseHtmlPptThemeSuggestJson,
  type HtmlPptOutlineLlmInput,
  type HtmlPptOutlineLlmResult,
  type HtmlPptPagePatchInput,
  type HtmlPptThemeSuggestInput,
  type HtmlPptThemeSuggestResult,
} from "../../shared/htmlPptOutlinePrompt.js";
import {
  PLATFORM_HTML_PPT_PAGE_MAX,
  PLATFORM_HTML_PPT_PAGE_MIN,
} from "../../shared/plans.js";
import type { HtmlPptPage, HtmlPptStyleId } from "../../shared/htmlPptMaker.js";

export { HTML_PPT_OUTLINE_CAPACITY_MESSAGE };

/** PPT 大纲专用上限：长稿 + 多 series */
const HTML_PPT_OUTLINE_MAX_TOKENS = 65000;
const HTML_PPT_THEME_SUGGEST_MAX_TOKENS = 8000;

/** 单段页数软上限：超过则分片，降低截断；≤10 仍单次 */
const CHUNK_SOFT_MAX = 6;
const SINGLE_SHOT_MAX = 10;

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

async function invokeSolJson(
  system: string,
  userBlock: string,
  reasoningEffort: ReasoningEffort,
  maxTokens = HTML_PPT_OUTLINE_MAX_TOKENS,
): Promise<string> {
  const hasKey = Boolean(
    String(process.env.OPENAI_API_KEY || "").trim() || String(process.env.EVOLINK_API_KEY || "").trim(),
  );
  if (!hasKey) {
    throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }
  const response = await invokeLLM({
    provider: "openai",
    modelName: getPlatformStage2OpenAiModel(),
    reasoningEffort,
    max_tokens: maxTokens,
    temperature: 0.55,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userBlock },
    ],
    response_format: { type: "json_object" },
  });
  return extractFirstChoicePlainText(response).trim();
}

async function invokeTerraJson(
  system: string,
  userBlock: string,
  reasoningEffort: ReasoningEffort,
  maxTokens = HTML_PPT_THEME_SUGGEST_MAX_TOKENS,
): Promise<string> {
  const hasKey = Boolean(
    String(process.env.OPENAI_API_KEY || "").trim() || String(process.env.EVOLINK_API_KEY || "").trim(),
  );
  if (!hasKey) {
    throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }
  const response = await invokeLLM({
    provider: "openai",
    modelName: getPlatformSkillQaOpenAiModel(),
    reasoningEffort,
    max_tokens: maxTokens,
    temperature: 0.6,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userBlock },
    ],
    response_format: { type: "json_object" },
  });
  return extractFirstChoicePlainText(response).trim();
}

async function invokeSolWithEffortFallback(
  system: string,
  userBlock: string,
  parse: (raw: string) => unknown,
): Promise<unknown> {
  const efforts: ReasoningEffort[] = ["high", "medium"];
  let lastError: unknown;
  for (const reasoningEffort of efforts) {
    try {
      const raw = await invokeSolJson(system, userBlock, reasoningEffort);
      if (!raw || raw.length < 20) {
        throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
      }
      return parse(raw);
    } catch (err) {
      lastError = err;
      console.warn(
        `[platformHtmlPptOutline] Sol 失败 (reasoning=${reasoningEffort}):`,
        err instanceof Error ? err.message.slice(0, 240) : err,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
}

async function generateOutlineOnce(
  input: HtmlPptOutlineLlmInput,
  pageCount: number,
  extraUserNote?: string,
): Promise<HtmlPptOutlineLlmResult> {
  const styleId = (input.styleId || "dark_research") as HtmlPptStyleId;
  const userBlock = [
    buildHtmlPptOutlineUserPrompt({
      title: input.title,
      purposeZh: input.purposeZh,
      pageCount,
      styleId,
      briefZh: input.briefZh,
      confirmedThemes: input.confirmedThemes,
    }),
    extraUserNote || "",
    "输出纪律：JSON 必须完整可 parse；每页 bullets≤4 条、每条≤36 字；note≤90 字；series label≤10 字。优先保证 series 数字准确。",
  ]
    .filter(Boolean)
    .join("\n");

  return (await invokeSolWithEffortFallback(
    buildHtmlPptOutlineSystemPrompt(),
    userBlock,
    (raw) => parseHtmlPptOutlineJson(raw, { pageCount }),
  )) as HtmlPptOutlineLlmResult;
}

/** 把总页数拆成每段 ≤CHUNK_SOFT_MAX 的块，降低长稿截断概率 */
export function splitHtmlPptOutlinePageChunks(pageCount: number): number[] {
  const n = Math.max(
    PLATFORM_HTML_PPT_PAGE_MIN,
    Math.min(PLATFORM_HTML_PPT_PAGE_MAX, Math.floor(pageCount || PLATFORM_HTML_PPT_PAGE_MIN)),
  );
  if (n <= SINGLE_SHOT_MAX) return [n];
  const chunks: number[] = [];
  let remain = n;
  while (remain > 0) {
    const left = chunks.length + 1;
    const partsLeft = Math.ceil(remain / CHUNK_SOFT_MAX);
    const size = Math.min(CHUNK_SOFT_MAX, Math.ceil(remain / partsLeft));
    chunks.push(size);
    remain -= size;
    if (left > 8) break;
  }
  const sum = chunks.reduce((a, b) => a + b, 0);
  if (sum !== n && chunks.length) {
    chunks[chunks.length - 1]! += n - sum;
  }
  return chunks.filter((c) => c > 0);
}

function chunkRoleNote(index: number, totalChunks: number, chunkPages: number, totalPages: number): string {
  if (totalChunks === 1) return "";
  if (index === 0) {
    return `本段是全稿第 1 段（共 ${totalChunks} 段，本段 ${chunkPages} 页，总目标 ${totalPages} 页）：须含封面 cover + 目录/议程 steps/hub + 至少 bars/line/ring 之一。不要写收束 CTA。`;
  }
  if (index === totalChunks - 1) {
    return `本段是全稿最后一段（本段 ${chunkPages} 页，总目标 ${totalPages} 页）。最后一页必须是收束/下一步（viz=steps）。须含 compare 或 columns 对照页。`;
  }
  return `本段是全稿中间段（第 ${index + 1}/${totalChunks} 段，本段 ${chunkPages} 页）。继续展开尚未覆盖的对比/数据/路径，勿重复前段标题，勿提前写收束 CTA。`;
}

export async function generateHtmlPptOutline(
  input: HtmlPptOutlineLlmInput,
): Promise<HtmlPptOutlineLlmResult & { model: string }> {
  const title = String(input.title || "").trim();
  if (title.length < 2) throw new Error("请填写主题");
  const pageCount = Math.max(
    PLATFORM_HTML_PPT_PAGE_MIN,
    Math.min(PLATFORM_HTML_PPT_PAGE_MAX, Math.floor(input.pageCount || PLATFORM_HTML_PPT_PAGE_MIN)),
  );
  const model = getPlatformStage2OpenAiModel();

  try {
    const chunks = splitHtmlPptOutlinePageChunks(pageCount);
    if (chunks.length === 1) {
      const parsed = await generateOutlineOnce(input, pageCount);
      return { ...parsed, model };
    }

    const allPages: HtmlPptOutlineLlmResult["pages"] = [];
    let deckTitle = "";
    let summary = "";
    const titlesSoFar: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkN = chunks[i]!;
      const part = await generateOutlineOnce(
        {
          ...input,
          briefZh: [
            String(input.briefZh || "").trim(),
            titlesSoFar.length
              ? `【已生成标题，勿重复】${titlesSoFar.map((t, idx) => `${idx + 1}.${t}`).join("；")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        chunkN,
        chunkRoleNote(i, chunks.length, chunkN, pageCount),
      );
      if (!deckTitle && part.deckTitle) deckTitle = part.deckTitle;
      if (!summary && part.summary) summary = part.summary;
      for (const p of part.pages) {
        allPages.push(p);
        titlesSoFar.push(p.title);
      }
    }

    const pages = allPages.slice(0, pageCount);
    if (pages.length < pageCount) {
      throw new Error(`模型返回页数不足（${pages.length}/${pageCount}），请重试`);
    }
    if (pages[0] && !pages[0].viz) pages[0] = { ...pages[0], viz: "cover" };
    const last = pages[pages.length - 1];
    if (last && !last.viz) pages[pages.length - 1] = { ...last, viz: "steps" };

    return {
      deckTitle: deckTitle || pages[0]?.title || title,
      summary,
      pages,
      model,
    };
  } catch (err) {
    console.warn(
      "[generateHtmlPptOutline] 全部失败:",
      err instanceof Error ? err.message.slice(0, 240) : err,
    );
    const msg = err instanceof Error ? err.message : String(err);
    if (/Unexpected end of JSON|JSON|parse|截断|页数不足/i.test(msg)) {
      throw new Error(`${HTML_PPT_OUTLINE_CAPACITY_MESSAGE}（输出不完整，请减少页数后重试）`);
    }
    throw err instanceof Error ? err : new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }
}

/** 主题补全 + 标题润色（Terra，服务层免费） */
export async function suggestHtmlPptThemes(
  input: HtmlPptThemeSuggestInput,
): Promise<HtmlPptThemeSuggestResult & { model: string }> {
  const title = String(input.title || "").trim();
  if (title.length < 2) throw new Error("请填写主题");
  const userThemes = (input.userThemes || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (userThemes.length < 3) throw new Error("请至少填写 3 个主题");

  const userBlock = buildHtmlPptThemeSuggestUserPrompt({
    title,
    purposeZh: input.purposeZh,
    briefZh: input.briefZh,
    userThemes,
  });
  const configured = resolvePlatformSkillQaReasoningEffort();
  const efforts: ReasoningEffort[] =
    configured === "high" || configured === "medium"
      ? [configured, configured === "high" ? "medium" : "high"]
      : ["medium", "high"];

  let lastError: unknown;
  const model = getPlatformSkillQaOpenAiModel();
  for (const reasoningEffort of efforts) {
    try {
      const raw = await invokeTerraJson(
        buildHtmlPptThemeSuggestSystemPrompt(),
        userBlock,
        reasoningEffort,
      );
      const parsed = parseHtmlPptThemeSuggestJson(raw);
      return {
        ...parsed,
        polishedTitle: parsed.polishedTitle || title,
        model,
      };
    } catch (err) {
      lastError = err;
      console.warn(
        "[suggestHtmlPptThemes] Terra 失败:",
        err instanceof Error ? err.message.slice(0, 240) : err,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
}

/** 单页重修（Sol high/65k） */
export async function patchHtmlPptPage(
  input: HtmlPptPagePatchInput,
): Promise<{ page: HtmlPptPage; model: string }> {
  const patchNote = String(input.patchNote || "").trim();
  if (patchNote.length < 2) throw new Error("请填写重修说明");
  if (!input.page?.title) throw new Error("缺少当前页内容");

  const userBlock = buildHtmlPptPagePatchUserPrompt(input);
  const page = (await invokeSolWithEffortFallback(
    buildHtmlPptPagePatchSystemPrompt(),
    userBlock,
    parseHtmlPptPagePatchJson,
  )) as HtmlPptPage;

  return { page, model: getPlatformStage2OpenAiModel() };
}
