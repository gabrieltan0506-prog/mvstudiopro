/**
 * 动效 PPT 页面清单：GPT-5.6 Sol 生成文案与图表数据（方案 A）。
 * 长页数分两段生成，避免网关/模型截断导致 Unexpected end of JSON。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm";
import {
  getPlatformStage2OpenAiModel,
  resolvePlatformStage2OpenAiReasoningEffort,
} from "../config/platformSwitches";
import {
  HTML_PPT_OUTLINE_CAPACITY_MESSAGE,
  buildHtmlPptOutlineSystemPrompt,
  buildHtmlPptOutlineUserPrompt,
  parseHtmlPptOutlineJson,
  type HtmlPptOutlineLlmInput,
  type HtmlPptOutlineLlmResult,
} from "../../shared/htmlPptOutlinePrompt.js";
import type { HtmlPptStyleId } from "../../shared/htmlPptMaker.js";

export { HTML_PPT_OUTLINE_CAPACITY_MESSAGE };

/** PPT 大纲专用上限：给足绝对量级 series，同时避免无谓超大 */
const HTML_PPT_OUTLINE_MAX_TOKENS = 16000;

async function invokeOutlineViaGpt56(
  userBlock: string,
  reasoningEffort: "low" | "minimal",
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
    max_tokens: HTML_PPT_OUTLINE_MAX_TOKENS,
    temperature: 0.55,
    messages: [
      { role: "system", content: buildHtmlPptOutlineSystemPrompt() },
      { role: "user", content: userBlock },
    ],
    response_format: { type: "json_object" },
  });
  return extractFirstChoicePlainText(response).trim();
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
    }),
    extraUserNote || "",
    "输出纪律：JSON 必须完整可 parse；每页 bullets≤4 条、每条≤36 字；note≤90 字；series label≤10 字。优先保证 series 数字准确。",
  ]
    .filter(Boolean)
    .join("\n");

  // 先 minimal：把预算留给 JSON，降低截断概率
  const efforts: Array<"minimal" | "low"> = ["minimal", "low"];
  const configured = resolvePlatformStage2OpenAiReasoningEffort();
  if (configured === "low" || configured === "minimal") {
    // keep order minimal→low
  } else {
    efforts.push("low");
  }

  let lastError: unknown;
  const seen = new Set<string>();
  for (const reasoningEffort of efforts) {
    if (seen.has(reasoningEffort)) continue;
    seen.add(reasoningEffort);
    try {
      const raw = await invokeOutlineViaGpt56(userBlock, reasoningEffort);
      if (!raw || raw.length < 20) {
        throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
      }
      return parseHtmlPptOutlineJson(raw, { pageCount });
    } catch (err) {
      lastError = err;
      console.warn(
        `[generateHtmlPptOutline] GPT-5.6 失败 (reasoning=${reasoningEffort}, pages=${pageCount}):`,
        err instanceof Error ? err.message.slice(0, 240) : err,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
}

export async function generateHtmlPptOutline(
  input: HtmlPptOutlineLlmInput,
): Promise<HtmlPptOutlineLlmResult & { model: string }> {
  const title = String(input.title || "").trim();
  if (title.length < 2) throw new Error("请填写主题");
  const pageCount = Math.max(3, Math.min(16, Math.floor(input.pageCount || 8)));
  const model = getPlatformStage2OpenAiModel();

  try {
    // ≤10 页单次；更长拆两段再拼接，规避截断
    if (pageCount <= 10) {
      const parsed = await generateOutlineOnce(input, pageCount);
      return { ...parsed, model };
    }

    const firstN = Math.ceil(pageCount / 2);
    const secondN = pageCount - firstN;
    const part1 = await generateOutlineOnce(
      input,
      firstN,
      `本段是全稿前 ${firstN} 页：须含封面 cover + 目录/议程 steps + 至少 bars/line/ring 之一。不要写收束 CTA。`,
    );
    const titlesSoFar = part1.pages.map((p, i) => `${i + 1}.${p.title}`).join("；");
    const part2 = await generateOutlineOnce(
      {
        ...input,
        briefZh: [
          String(input.briefZh || "").trim(),
          `【已生成前半标题，勿重复】${titlesSoFar}`,
          "本段接续后半：须覆盖尚未讲清的对比/平台/政策/入局/坑，并以 steps 收束页结束。",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      secondN,
      `本段是全稿后 ${secondN} 页（总目标 ${pageCount} 页）。最后一页必须是收束/下一步（viz=steps）。须含 compare 或 columns 对照页。`,
    );

    const pages = [...part1.pages, ...part2.pages].slice(0, pageCount);
    if (pages.length < 3) throw new Error("模型返回页数不足，请重试");
    if (pages[0] && !pages[0].viz) pages[0] = { ...pages[0], viz: "cover" };
    const last = pages[pages.length - 1];
    if (last && !last.viz) pages[pages.length - 1] = { ...last, viz: "steps" };

    return {
      deckTitle: part1.deckTitle || part2.deckTitle,
      summary: part1.summary || part2.summary,
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
      throw new Error(`${HTML_PPT_OUTLINE_CAPACITY_MESSAGE}（输出被截断，请将页数调到 10 以内后重试）`);
    }
    throw err instanceof Error ? err : new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }
}
