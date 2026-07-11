import { z } from "zod";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import {
  GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS,
  DEFAULT_GEMINI_35_FLASH_MODEL,
  resolveGemini35FlashModelName,
} from "./gemini35FlashRuntime.js";
import { isPlatformImageOpenAiAllowed } from "../config/platformSwitches.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";
import {
  appendFashionEditorialCharacterGuidance,
  PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH,
} from "../../shared/platformFashionEditorialCharacter.js";
import { STORYBOARD_ON_IMAGE_TEXT_ZH } from "../../shared/storyboardTextClarity.js";
import {
  STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH,
  STORYBOARD_PANEL_TABLE_FIELDS_ZH,
} from "../../shared/storyboardLightingEmotion.js";

/** 舊 API 別名：歷史 `storyboard_sheet_portrait` 與橫版 16:9·2×4 分鏡表為同一產物，一律正規化為 `storyboard_sheet_landscape`。 */
export function normalizeCompositeSheetKind(
  kind:
    | "storyboard_sheet_portrait"
    | "storyboard_sheet_landscape"
    | "xiaohongshu_dual_note"
    | "single_page_knowledge_card",
): "storyboard_sheet_landscape" | "xiaohongshu_dual_note" | "single_page_knowledge_card" {
  return kind === "storyboard_sheet_portrait" ? "storyboard_sheet_landscape" : kind;
}

/** 寫入平台頁 / 寬幅合成 debug 時間線（與 imageGenFlowLog 同源）。 */
function appendVertexFlashDebug(flowLog: string[] | undefined, line: string): void {
  if (!flowLog) return;
  flowLog.push(`${platformFlowLogTimestamp()}  [Vertex·Flash] ${line}`);
}

/** 將異常打成可讀字串（debug：盡量完整，單條上限防極端爆滿日誌）。 */
const MAX_DEBUG_ERR_CHARS = 65536;

function formatErrForVertexDebug(e: unknown): string {
  const cap = (s: string) =>
    s.length <= MAX_DEBUG_ERR_CHARS ? s : `${s.slice(0, MAX_DEBUG_ERR_CHARS)}\n…(truncated at ${MAX_DEBUG_ERR_CHARS} chars)`;

  if (e instanceof Error) {
    const parts: string[] = [`${e.name}: ${e.message || "(no message)"}`];
    if (e.stack) {
      parts.push(`stack:\n${e.stack}`);
    }
    const any = e as Error & Record<string, unknown>;
    for (const k of ["code", "status", "statusCode", "reason"] as const) {
      const v = any[k];
      if (v != null && v !== "") {
        try {
          parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
        } catch {
          parts.push(`${k}=${String(v)}`);
        }
      }
    }
    if (any.error != null) {
      try {
        parts.push(`error=${typeof any.error === "object" ? JSON.stringify(any.error) : String(any.error)}`);
      } catch {
        parts.push(`error=${String(any.error)}`);
      }
    }
    let c: unknown = e.cause;
    let depth = 0;
    while (c != null && depth < 8) {
      parts.push(`cause[${depth}]:\n${formatErrForVertexDebug(c)}`);
      c = c instanceof Error ? c.cause : null;
      depth += 1;
    }
    return cap(parts.join("\n"));
  }
  if (e != null && typeof e === "object") {
    try {
      return cap(JSON.stringify(e, null, 2));
    } catch {
      return cap(String(e));
    }
  }
  return cap(String(e));
}

/** 與 @google/genai Vertex 客戶端一致：專案 ID。 */
export function resolveVertexProjectIdForGenAi(): string {
  const p = String(
    process.env.GCP_PROJECT_ID ||
      process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "",
  ).trim();
  if (!p) {
    throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  }
  return p;
}

/**
 * 平台英文化 · Flash：**預設 `global`**（與專案 Console 開通習慣一致；文本高品質路徑見 `server/services/vertexGemini31ProGlobal.ts`）。
 * 可 `VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION` 覆寫為 `us-central1` 等。
 */
export function resolveVertexFlashTranslationLocation(): string {
  const loc = String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION || "global").trim();
  return loc || "global";
}

/** 預設 Vertex Flash 翻譯模型 ID（**2×4／分鏡／八格 composite** 与竖封封面）。可 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL = DEFAULT_GEMINI_35_FLASH_MODEL;

export function resolveVertexFlashTranslationModelName(): string {
  return (
    String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || "").trim() ||
    resolveGemini35FlashModelName()
  );
}

/** **選題豎封封面**英文化：与 composite 统一 **Gemini 3.5 Flash**。可 `VERTEX_GEMINI_COVER_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_COVER_TRANSLATION_MODEL = DEFAULT_GEMINI_35_FLASH_MODEL;

export function resolveVertexCoverTranslationModelName(): string {
  return (
    String(process.env.VERTEX_GEMINI_COVER_TRANSLATION_MODEL || "").trim() ||
    resolveGemini35FlashModelName()
  );
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化溫度（可 `VERTEX_GEMINI_COVER_TRANSLATION_TEMPERATURE` 覆寫，0～2）。
 * 預設 **0.7**（與 Gemini 建議「華麗翻譯 + 仍守 JSON」平衡；豎封與 Flash 網格可獨立調參）。
 */
export function resolveVertexCoverTranslationTemperature(): number {
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.7;
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化 **Top-P**（可 `VERTEX_GEMINI_COVER_TRANSLATION_TOP_P` 覆寫，0～1）。
 * 預設 **0.9**。
 */
export function resolveVertexCoverTranslationTopP(): number {
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_TOP_P;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return 0.9;
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化 **`maxOutputTokens`**（可 `VERTEX_GEMINI_COVER_TRANSLATION_MAX_TOKENS` 覆寫）。
 * 預設 **32768**（32K）；合法範圍 **4096～65536**。
 */
export function resolveVertexCoverTranslationMaxOutputTokens(): number {
  const fallback = 32768;
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_MAX_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n)) {
      const clamped = Math.min(65536, Math.max(4096, n));
      return clamped;
    }
  }
  return fallback;
}

/**
 * Vertex Flash 英文化溫度（可 `VERTEX_FLASH_TRANSLATION_TEMPERATURE` 覆寫，0～2）。
 * 預設 **0.7**（生图提示词：艺术性与结构精准的黄金交叉）。
 */
export function resolveVertexFlashTranslationTemperature(): number {
  const raw = process.env.VERTEX_FLASH_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.7;
}

/**
 * Vertex Flash 英文化 **Top-P**（可 `VERTEX_FLASH_TRANSLATION_TOP_P` 覆寫，0～1）。
 * 預設 **0.9**。
 */
export function resolveVertexFlashTranslationTopP(): number {
  const raw = process.env.VERTEX_FLASH_TRANSLATION_TOP_P;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return 0.9;
}

/**
 * Gemini 3 系可選 **thinkingConfig**（@google/genai 會原樣帶入 Vertex REST）。
 * - `VERTEX_FLASH_TRANSLATION_THINKING_LEVEL`：`MINIMAL` | `LOW` | `MEDIUM` | `HIGH`，預設 **`HIGH`**（更深推演，延時與成本較高）。
 * - 設為 `OFF` / `NONE` / `FALSE` / `0` 則**不送** thinking 欄位（兼容舊端點）。
 */
export function resolveVertexFlashThinkingConfigForSdk(): {
  thinkingConfig?: { thinkingLevel: string; includeThoughts: boolean };
} {
  const raw = String(process.env.VERTEX_FLASH_TRANSLATION_THINKING_LEVEL ?? "HIGH").trim().toUpperCase();
  if (!raw || raw === "OFF" || raw === "NONE" || raw === "FALSE" || raw === "0") {
    return {};
  }
  const allowed = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
  const level = allowed.has(raw) ? raw : "HIGH";
  return {
    thinkingConfig: {
      thinkingLevel: level,
      includeThoughts: false,
    },
  };
}

/**
 * Vertex Flash 英文化 **`maxOutputTokens`**（可 `VERTEX_FLASH_TRANSLATION_MAX_TOKENS` 覆寫）。
 * 預設 **32768**：長版 JSON / 長英文 prompt 更不易被截斷。
 * 合法範圍 **4096～65536**（非數字或超出範圍時回退預設）。
 */
export function resolveVertexFlashTranslationMaxOutputTokens(): number {
  const fallback = GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS;
  const raw = process.env.VERTEX_FLASH_TRANSLATION_MAX_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n)) {
      const clamped = Math.min(65536, Math.max(4096, n));
      return clamped;
    }
  }
  return fallback;
}

/** 從環境變數構造 google-auth-library 可用的 credentials（Fly / Vercel JSON）。 */
export function buildGoogleGenAiAuthOptionsFromEnv():
  | { credentials: { client_email: string; private_key: string } }
  | undefined {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw || raw === "{}") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = parsed.client_email;
    const pk = parsed.private_key;
    if (typeof email === "string" && typeof pk === "string") {
      return {
        credentials: {
          client_email: email,
          private_key: pk.replace(/\\n/g, "\n"),
        },
      };
    }
  } catch (e) {
    console.warn("[vertexGenai] 解析 GOOGLE_APPLICATION_CREDENTIALS_JSON 失败:", e);
  }
  return undefined;
}

/** 平台单帧 / 批量封面 / 宽幅合成：保留 API 入参兼容（已不再用于英文化路由）。 */
export type PlatformImagePromptTranslator = "gpt54" | "vertex_gemini_3_flash_preview";

/** 宽幅合成等链路失败时对用户显示的通用消息（历史兼容）。 */
export const PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE = "系统算力紧张，请稍后再试";

/**
 * tRPC / 作業入參：接受新 slug 與舊版錯名 `vertex_gemini_31_pro_preview`（自動正規化為 Flash）。
 */
export const zPlatformImagePromptTranslatorInput = z
  .union([
    z.literal("gpt54"),
    z.literal("vertex_gemini_3_flash_preview"),
    z.literal("vertex_gemini_31_pro_preview"),
  ])
  .optional()
  .transform((v) => {
    if (v === "vertex_gemini_31_pro_preview") return "vertex_gemini_3_flash_preview";
    return v;
  });

/**
 * 平台选题生图：中文剧本/文案直送 GPT-IMAGE-2；英文仅用于像素锁等结构后缀。
 */

const SCRIPT_SLICE = 3500;
/** 中文视觉骨架：允许充分保留剧本信息。 */
const CHINESE_VISUAL_BRIEF_MAX_CHARS = SCRIPT_SLICE;

/** 平台选题 **单帧封面**：附在中文直送 prompt 末尾的版式补充（含简中主标题要求）。 */
const PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER = `
【版式补充】
1. 竖版 9:16 单帧满版主视觉，单一主体；避免无意做成 2×4 或多格分镜。
2. 主标题为**简体中文**，大而清晰；场景随选题多样化，避免千篇一律书房/客厅套路。
3. 建议 2–4 个线描小图标 + 简中辅标，自然融入光影，不压过主标题。
4. masterpiece、8k；屏内文字一律简体中文、印刷清晰。
`.trim();

export function stripGeminiModelOutput(raw: string): string {
  let t = String(raw || "").trim();
  const fence = /^```(?:[a-zA-Z0-9+-]*)?\s*([\s\S]*?)```$/;
  const m = t.match(fence);
  if (m?.[1]) t = m[1].trim();
  return t.replace(/^["']|["']$/g, "").trim();
}

export async function extractChineseVisualBrief(rawContext: string, flowLog?: string[]): Promise<string> {
  const slice = String(rawContext || "").trim().slice(0, SCRIPT_SLICE);
  if (!slice) {
    appendVertexFlashDebug(flowLog, `[骨架·中文视觉] 輸入為空，跳過 extractChineseVisualBrief`);
    return "";
  }

  appendVertexFlashDebug(
    flowLog,
    `[骨架·中文视觉] extractChineseVisualBrief 開始 · 輸入約 ${slice.length} 字（上限切片 ${SCRIPT_SLICE}）`,
  );

  if (!isPlatformImageOpenAiAllowed()) {
    appendVertexFlashDebug(
      flowLog,
      `[骨架·中文视觉] OpenAI 未啟用（未設 PLATFORM_IMAGE_ALLOW_OPENAI=1）· 跳過 GPT 骨架 · 回傳原文切片`,
    );
    return slice.slice(0, CHINESE_VISUAL_BRIEF_MAX_CHARS);
  }

  appendVertexFlashDebug(flowLog, `[骨架·中文视觉] GPT 5.4 → JSON brief …`);

  try {
  const response = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    max_tokens: 8192,
    messages: [
      {
        role: "system",
        content: [
          "你是一位像莎士比亚剧场里锤炼台词那样锤炼画面的双语视觉艺术总监：精通视觉层级与隐喻，读中文时像解构艺术品一样抓住「最省字、最有视觉穿透力」的那几笔。",
          "只做一步：从输入里抽出中文「视觉骨架」，不做英文翻译。",
          "在不过度淹没细节的前提下提炼：保留具有张力的关键词；剥离纯解释性废话、空洞修辞与俗套联想；必须完整保留 Hook、身份锚点、核心隐喻道具与视觉动作。",
          "若输入宽幅 2×4 **电影分镜主表**剧本：骨架里区分——**全文内容总结**（适合放在整表顶栏的一句汇总）与各格 **分镜主题**（每格一句）及可填入 **景别/运镜/画面内容/台词与音效** 的要点，不建議把各格主题误并入「顶栏总结」混写。",
          "若偏封面用途：尽量留下 **标题可视化的设色/字级/对比意图**、**能引起好奇的视觉钩子詞**（动作瞬间、對撞关系、未完叙事）以及 **内文关键场景**（可转译为画面的空间、道具、光线），并**务必**留下 **2～4 个可入画的具象图标题材**（与 Hook、正文关键词**一一对应**，供下游**必出**线稿小图标+简中辅标，忌泛泛符号）。",
          "保留：情绪底色、高级光影、场景倾向、镜头气质、排版张力；若文中有**职业、身份、专长**等人设线索，须提炼为**可被拍摄的高级视觉符号**，拒绝泛化。",
          "若正文主題明顯與餐食、烹飪無關，不必主動引入廚房、食譜表等構圖；若brief里有食物叙事再保留即可。",
          "场景提炼：**强烈建议**让场景服务于词义隐喻并极度多元化；**室内外无界**。**不推荐**无脑固化在书房、满架书本或**重复的客厅沙发区**；保留与题材精神高度吻合的**具体场所词**（例如：极简美术馆、废墟、自然旷野、精密空间等）。**多选题时****强烈建议**在骨架中植入**截然不同、具象且高级**的场景锚点。",
          "请返回 JSON 对象，仅含一个键 brief，例如：{\"brief\":\"...\"}；brief 不建议留空。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `请先提取中文视觉骨架，再供后续生图使用。输入内容：\n${slice}`,
      },
    ],
  });

  const raw = String(response.choices[0]?.message?.content || "").trim();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(extractJsonString(raw));
  } catch {
    parsed = null;
  }

  const brief = String(parsed?.brief || "").trim();
  const out = brief.slice(0, CHINESE_VISUAL_BRIEF_MAX_CHARS);
  appendVertexFlashDebug(
    flowLog,
    `[骨架·中文视觉] 完成 · brief 約 ${out.length} 字 · JSON 解析=${parsed ? "ok" : "失敗(用原始片段推理)"}`,
  );
  return out;
  } catch (e: unknown) {
    appendVertexFlashDebug(flowLog, `[骨架·中文视觉] 异常: ${formatErrForVertexDebug(e)}`);
    throw e;
  }
}

/**
 * **单页连贯图文知识卡片**（kind=`single_page_knowledge_card`，自定义文案专用）的**中文**艺术指令。
 *
 * ⚠️ 与小红书八格不同：此路径**取消英文翻译**，直接把这段中文 directive + Markdown 原文送 GPT-Image-2，
 * 以保留书法标题 / 大师写实摄影 + 文艺复兴手绘 / 山茶花蝴蝶洋牡丹装饰 / 宣纸暖色底等细腻美学
 * （中文直送 GPT-IMAGE-2，不经英文翻译）。与 2×4 八格路径互不影响。
 */
export const SINGLE_PAGE_KNOWLEDGE_CARD_DIRECTIVE_ZH = `你是一位顶尖的归纳知识内容、规划整理的知识卡片设计师（Knowledge Card Visual Designer），精通解读 Markdown 文档，擅长把"文档内容"画成知识分解图。请把下方 Markdown 的详细内容做成**一整页连贯的单页图文知识卡片**（务必是"单页连贯"，而非 2×4 八格网格、也不是分镜表），用连贯的叙述把不同子标题的内容依序呈现。

【任务目标】
- 内容详尽充实、覆盖每个子标题的关键点、校对文稿保持正确；用简体中文解说，措辞通畅易懂、有趣可读。
- 标题：采用书法楷书字体、金橙色字体并以淡蓝紫色描边包裹每个标题字，字体用渐变色，呈现优雅飘逸的美感。
- 内文：务必印刷清晰、绝不可模糊；执行内文小字的清晰度优化，并把当前内文小字**放大一级**（字号比主题小一级），兼顾排版美观与可读性。

【信息密度·文字渲染（关键）】
- 信息密度优先：内容务必**详尽充实、宁详勿略**，信息量对标排版成熟、字数密集的高质量图文笔记（参考密度只能更高、不能更少）。把每个子标题下的内容展开成 **5-9 条要点**，每条写成信息完整的短句（约 12-30 字，含定义 / 数字 / 方法 / 示例），覆盖该子标题的全部关键知识点，**不要为了简洁而删减内容**。
- 在保证内容详尽的同时确保**字迹清晰**：每个文字块留足够留白、字号足够大，即使密集排布也要让每个汉字笔画清晰、不粘连、不变形、不重复、不缺笔。
- 关键数据 / 百分比 / 方法步骤 / 示例都要完整渲染出来；每个汉字必须是**真实存在、写法正确**的规范简体字，严禁生造字、错字、半个字或火星文。

【视觉规范】
- 主体构图：在中央或左上方放置文档的核心视觉意象；画面采用摄影大师写实风格 + 透视学审美 + 当代大师艺术手稿素描结合的精致画面。
- 四周环绕模块：以均匀布局围绕主体，层递排列文档中各类详尽知识点。
- 图标：每段详细内文配上立体透视的素描图标，加深各类知识的印象；图标要带有冲击力，多种色彩、强烈对比。
- 连接结构：用贝聿铭大师风格的素描线稿与写实美学线条，以及大师彩绘的各色山茶花、不同种蝴蝶、洋牡丹作为视觉链接；知识点用生动的符号或精致图形串接表达；**不要使用内部边框，法式大师设计风格的立体透视素描边框只出现在最外层**；严格避免箭头重叠、视觉不混乱。

【内容拆解】
- 把文档分成若干子标题，均匀分配在卡片上，用优雅、叙述通畅的文字与细致图标解释每个子标题；排版合理、说明详细、文字印刷清晰正确。
- 结尾需把关键重点详细凝练地收束（不要写出"总结"等小标题），直接呈现核心要点；**是否在结尾生成诗词 / 书法点睛金句，以下方【收尾】指令为准**。

【核心要求】
- 风格混合：文艺复兴时期大师手绘艺术插画（透视学素描）+ 贝聿铭大师级绝美写实摄影立体风格图标，二者组合；整体如同用彩色画笔在画布上绘制，所有元素细腻有质感、强烈视觉冲击。
- 构图布局：清晰完整、有逻辑，能自然引导读者视线；元素从左到右合理安排，填满画布以保证视觉均衡，不要过度居中。
- 颜色：暖色调为主、清爽合理；背景采用爱马仕橙色到浅紫的渐变（亦可用宣纸/绢本底色，春天淡紫加粉色渐变色谱），圆角、阴影、适当字体层次的现代设计；**图文笔记中不要有任何灰色的图像**，图标与符号都要彩色、有视觉冲击力；注释文字用橙色书法楷书、浅蓝描边。

【输出格式】完整描述、内容连贯、文字详尽、简体中文印刷清晰正确 / 高清 4K / 横向 16:9 构图。若文档有难以理解之处，先在内部翻译成英文校对原意，再生成简体中文叙述。`;

/**
 * 英文「渲染外壳」：内容用中文（保美学），但用一段简短英文**强约束模型如何渲染中文字**——
 * 模型对英文 meta 指令解析最稳，可显著降低密集简体中文的乱码/重复/缺笔概率。
 */
export const SINGLE_PAGE_KNOWLEDGE_CARD_TEXT_RENDER_WRAPPER_EN = `TEXT RENDERING (CRITICAL): All on-image text is **Simplified Chinese**. The card must be **content-rich and information-dense** — include detailed bullet points, key data/percentages, methods and concise explanatory lines for EVERY section; do NOT thin out or omit content for the sake of brevity. AT THE SAME TIME render every Chinese glyph **crisp, print-clear and correctly-formed** — no garbled, duplicated, missing/broken strokes, no invented or wrong characters — by spacing blocks well and keeping font size adequate even when dense. Wide 16:9 landscape, ultra high-resolution. Do NOT add any English sentences onto the card except tiny optional accent keywords.`;

/** 上篇 / 下篇：知识卡片分两页商业化用。`upper`=上篇（免费预览思路）、`lower`=下篇。 */
export type KnowledgeCardNotePart = "upper" | "lower";

/**
 * 把 Markdown 文稿按 `##` 子标题**对半切**成上篇 / 下篇（切不开则按长度对半）。
 * H1 文档大标题在两页都保留（作为各页标题来源）；上篇含 H1 + 前导段 + 前半子标题，下篇含 H1 + 后半子标题。
 */
export function splitKnowledgeCardMarkdown(scriptContext: string): { upper: string; lower: string } {
  const full = String(scriptContext || "").trim();
  if (!full) return { upper: "", lower: "" };

  const lines = full.split(/\r?\n/);
  // H1 文档大标题（首个 `# ` 行）
  const h1 = lines.find((l) => /^#\s+/.test(l.trim()))?.trim() ?? "";

  // 以 `## ` 子标题切块：preamble（首个 `## ` 之前的所有内容）+ 各子标题块
  const sectionStarts: number[] = [];
  lines.forEach((l, i) => {
    if (/^##\s+/.test(l.trim())) sectionStarts.push(i);
  });

  if (sectionStarts.length >= 2) {
    const preamble = lines.slice(0, sectionStarts[0]).join("\n").trim();
    const sections: string[] = sectionStarts.map((start, idx) => {
      const end = idx + 1 < sectionStarts.length ? sectionStarts[idx + 1] : lines.length;
      return lines.slice(start, end).join("\n").trim();
    });
    const half = Math.ceil(sections.length / 2);
    const upperSections = sections.slice(0, half);
    const lowerSections = sections.slice(half);
    const upper = [preamble, ...upperSections].filter(Boolean).join("\n\n").trim();
    // 下篇保留 H1 大标题作为上下文，再接后半子标题
    const lowerHead = h1 && !lowerSections[0]?.startsWith(h1) ? h1 : "";
    const lower = [lowerHead, ...lowerSections].filter(Boolean).join("\n\n").trim();
    return { upper, lower: lower || upper };
  }

  // 没有足够子标题：按字符长度对半切；下篇前补 H1
  const mid = Math.ceil(full.length / 2);
  const upper = full.slice(0, mid).trim();
  const lowerBody = full.slice(mid).trim();
  const lower = h1 ? `${h1}\n\n${lowerBody}`.trim() : lowerBody;
  return { upper, lower };
}

/**
 * **单页连贯图文知识卡片**（自定义文案专用）：组装**直接送 GPT-Image-2** 的 prompt。
 * 结构 = 中文艺术 directive（保美学）+ 上下篇分页指令（如有）+ Markdown 内容 + 英文渲染外壳（防乱码）。
 * 本路径**不经过英文翻译**，与小红书八格 {@link buildXhsNoteGeminiPrompt} 完全独立。
 *
 * @param notePart 传入 `upper`/`lower` 时，仅取对应半篇内容并在标题末尾标注「（上篇）」/「（下篇）」。不传则整篇。
 */
export function buildSinglePageKnowledgeCardImagePrompt(
  scriptContext: string,
  notePart?: KnowledgeCardNotePart,
): string {
  const source =
    notePart === "upper"
      ? splitKnowledgeCardMarkdown(scriptContext).upper
      : notePart === "lower"
        ? splitKnowledgeCardMarkdown(scriptContext).lower
        : String(scriptContext || "");
  const slice = source.slice(0, SCRIPT_SLICE);

  const partDirective =
    notePart === "upper"
      ? `\n【分页·上篇】本页是该主题图文笔记的【上篇】（共上下两篇）。请在文档大标题的末尾追加「（上篇）」字样；**只**呈现下方提供的这半部分内容，做成一份完整、连贯、精致且**信息详尽**的单页知识卡片（内容只多不少、宁详勿略，把每个子标题充分展开；不要画出下篇内容，也不要写"未完待续"之外的占位）。\n【收尾·上篇】上篇结尾**不要**生成任何诗词、金句或书法点睛横幅；把底部版面同样用于详尽的知识点内容。`
      : notePart === "lower"
        ? `\n【分页·下篇】本页是该主题图文笔记的【下篇】（承接上篇，共上下两篇）。请在文档大标题的末尾追加「（下篇）」字样；**只**呈现下方提供的这半部分内容，做成一份完整、连贯、精致且**信息详尽**的单页知识卡片（内容只多不少、宁详勿略，把每个子标题充分展开），整体风格须与上篇保持一致。\n【收尾·下篇】下篇结尾请生成 **1 首当代诗词**阐释全文核心知识点，并配 1 句楷书书法点睛语横幅 + 诗意插图与视觉链接（不要写出"金句"二字），四周放置图标与相关视觉链接。`
        : `\n【收尾】本页不生成诗词、金句或书法点睛横幅；版面全部用于详尽的知识点内容。`;

  return `${SINGLE_PAGE_KNOWLEDGE_CARD_DIRECTIVE_ZH}${partDirective}

【以下为 Markdown 文稿内容，请按上述要求生成单页连贯图文知识卡片（而非 2×4 八格）】：
${slice}

${SINGLE_PAGE_KNOWLEDGE_CARD_TEXT_RENDER_WRAPPER_EN}`.trim();
}

/**
 * **2×4 分镜 / 小红书八格**（或 **3×4 分段横排**）的「中文直送主体」。
 * 仅产出**中文画面主体**；调用方仍会在其后拼接英文像素锁（`GPT_IMAGE2_*_2X4_PIXEL_LOCK` / `*_ROWBAND_*`）+ 顶栏注入 + 镜头/光影 modifier。
 */
export function buildCompositeSheetDirectChineseBody(
  kind:
    | "storyboard_sheet_portrait"
    | "storyboard_sheet_landscape"
    | "xiaohongshu_dual_note",
  scriptContext: string,
  opts?: { rowBand?: boolean; sectionIndex?: number; sectionTotal?: number },
): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  const isStoryboard = kind === "storyboard_sheet_landscape" || kind === "storyboard_sheet_portrait";
  const rowBand = Boolean(opts?.rowBand);
  const sectionIndex = Math.max(0, Math.floor(opts?.sectionIndex ?? 0));
  const sectionTotal = Math.max(1, Math.floor(opts?.sectionTotal ?? 3));
  const badgeStart = sectionIndex * 4 + 1;
  const badgeEnd = badgeStart + 3;
  const badgeRange = `${String(badgeStart).padStart(2, "0")}–${String(badgeEnd).padStart(2, "0")}`;
  if (isStoryboard) {
    if (rowBand) {
      return `请直接据下方中文脚本生成**3×4 十二格长图中的一整横排分镜**（横版约 16:9，仅 **1 行 × 4 列共 4 格**，不要画成完整 2×4 八格）：
- 严格排成单横排四格，格线笔直、格间留白清晰，左→右顺扫；本段将与其他横排纵向拼成 3×4 长图（本横排序号建议 ${badgeRange}，整表 01–12）。
- 每一格自上而下：① 本格分镜主题（一行加粗简体中文）；② 该镜头电影级写实剧照（高细节，约占 65–70%）；③ 格内底部约 30–35% 为简体中文六栏小表，表头固定【${STORYBOARD_PANEL_TABLE_FIELDS_ZH}】六栏都要填（含灯光安排与情绪表达）。
- 风格：电影感、8k、精致布光、统一高级色调；所有屏内文字一律**简体中文、印刷清晰、不可乱码/缺笔**。
${STORYBOARD_ON_IMAGE_TEXT_ZH}
${STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH}
- 若脚本含【光影与机位约束·拍摄手法】或【上传素材拍摄技法】，四格的景别/运镜/布光/走位/情绪**强烈建议**对齐该约束（教学演示类优先固定中远景、前景操作物、背景大屏同步）。
- 现代主讲/主人公人物造型须对齐【人物造型·国际时尚大片】：配合场景的高雅/高贵时装，VOGUE·ELLE·Harper's Bazaar·好莱坞时尚编辑气质；妆发皮肤高级真实，配饰可点缀勿硬配；与其他分段跨段同一人、同一阶层气质、同一布光色调。若有参考人像：**锁脸硬约束**，衣着可随场景微调。

【中文脚本】：
${slice}`;
    }
    return `请直接据下方中文脚本生成一张**电影级 2×4 八格分镜参考图**（横版约 16:9 单张主表，不是单张满版海报）：
- 顶部约 8–12% 为通栏【内容总结】标题栏（简体中文·全片梗概，不放各格分镜标题）。
- 其下严格排成 **2 行 × 4 列、共 8 格**，格线笔直、格间留白清晰，按 row1 左→右、row2 左→右顺扫。
- 每一格自上而下：① 本格分镜主题（一行加粗简体中文）；② 该镜头电影级写实剧照（高细节，约占 65–70%）；③ 格内底部约 30–35% 为简体中文六栏小表，表头固定【${STORYBOARD_PANEL_TABLE_FIELDS_ZH}】六栏都要填（含灯光安排与情绪表达）。
- 风格：电影感、8k、精致布光、统一高级色调；所有屏内文字一律**简体中文、印刷清晰、不可乱码/缺笔**。
${STORYBOARD_ON_IMAGE_TEXT_ZH}
${STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH}
- 若脚本含【光影与机位约束·拍摄手法】或【上传素材拍摄技法】，八格的景别/运镜/布光/走位/情绪**强烈建议**对齐该约束（教学演示类优先固定中远景、前景操作物、背景大屏同步）。
- 现代主讲/主人公人物造型须对齐【人物造型·国际时尚大片】：配合场景的高雅/高贵时装，VOGUE·ELLE·Harper's Bazaar·好莱坞时尚编辑气质；妆发皮肤高级真实，配饰可点缀勿硬配；跨格服装可随场景微调但须保持同一人与同一阶层气质。若有参考人像：**锁脸硬约束**，衣着可随场景微调。

【中文脚本】：
${slice}`;
  }
  if (rowBand) {
    return `请直接据下方中文文案生成**3×4 十二格长图中的一整横排图文笔记**（横版约 16:9，仅 **1 行 × 4 列共 4 格**，不要画成完整 2×4 八格）：
- 严格排成单横排四格，格线笔直、四格等宽；每格为一个知识/内容要点：醒目简体中文小标题 + 要点短句 + 扁平插画/图标/序号徽章 **${badgeRange}**（整张长图共 12 格 01–12，本段为第 ${sectionIndex + 1}/${sectionTotal} 横排）。
- **硬约束**：本图只能出现序号 ${badgeRange}；禁止画 2 行、禁止八格、禁止把全文 01–08 再画一遍；若文案里出现其他序号，忽略并以本横排四格主题为准。
- 画风为**扁平插画信息图**（与优质 2×4 八格图文同级清晰度）；屏内文字一律**简体中文、清晰不乱码**；与其他分段跨段同色调同边框以便拼接。
- 若格内出现现代解说/主人公人物：须与参考人像**同脸**（锁脸）；衣着可随该格场景微调，勿换人。

【中文文案】：
${slice}`;
  }
  return `请直接据下方中文文案生成一张**小红书风格 2×4 八格图文笔记参考图**（横版约 16:9 单张主表，不是单张满版海报）：
- 严格排成 **2 行 × 4 列、共 8 格**，格线笔直、格间留白清晰，按 row1 左→右、row2 左→右顺扫。
- 每格为一个知识/内容要点：醒目简体中文小标题 + 要点短句 + 扁平插画/图标/序号徽章 01–08；整体暖色粉彩、明快多彩、高级商务审美、印刷清晰。
- 画风为**扁平插画信息图（单页图文笔记风）**，不要电影写实摄影或暗调光影；屏内文字一律**简体中文、清晰不乱码**（英文仅作极少量点缀）。
- 若格内出现现代解说/主人公人物：须与参考人像**同脸**（锁脸）；衣着可随该格场景微调，勿换人。

【中文文案】：
${slice}`;
}

/**
 * **平台选题单帧封面** 的「中文直送 prompt」。
 */
export function buildPlatformTopicCoverDirectChinesePrompt(input: {
  topicHook: string;
  context: string;
  variant: "video" | "graphic";
  coverPersonaContext?: string;
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 120);
  const ctx = String(input.context || "").slice(0, SCRIPT_SLICE);
  const persona = appendFashionEditorialCharacterGuidance(
    String(input.coverPersonaContext || "").trim(),
    { maxChars: 2200, lang: "zh" },
  );
  const personaBlock = persona
    ? `【身份锚点】（人物服装 / 道具 / 环境须与此一致）：\n${persona}\n\n`
    : `【身份锚点】\n${PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH}\n\n`;
  return `${personaBlock}请直接据下方选题与语境生成**一张竖版 9:16 单帧信息流封面**（单一主体、满版主视觉，不要做成 2×4 网格或多格分镜）：

【停滑封面·硬约束】
- 主标题用**简体中文**，**8–14 字**为佳，大而清晰、印刷级，紧扣「${hook}」；只表达**一个**信息缺口。可有一行副标（≤18 字），总共可见文案 **≤2 行**。
- **禁止**百科封面：长段论述、履历堆砌、四条以上卖点清单、多图标+多辅标栏、说明书式信息图。
- **禁止**默认暗沉、低照度、压抑严肃、葬礼感光影；须**生活化、年轻化、健康化、有温度的高级感**。
- 优先自然日光 / 户外或生活场域、明快克制配色 + 一处鲜明强调色；高级时尚可以，但要有点击欲，不要死板正装肖像海报。
- 场景随文案多样化、贴合选题；人物脸/上半身可读，主标题不压脸。
- **不要**为「显得专业」强行加 2–4 个线描图标栏；最多 0–1 个极克制点缀，且不可抢主句。
- masterpiece、8k、视觉冲击力强；屏内文字一律**简体中文、清晰不乱码**。

【选题主句】：「${hook}」
【语境（据文案调场景与情绪，勿把语境全文印上封面）】：
${ctx}

${PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER}`.trim();
}

/** 战略智库杂志封面：双语编导（Vertex Global · gemini-3.1-pro-preview）把中文题与出版语境压成英文视觉 prompt → GPT-IMAGE-2 */
export function buildStrategicCoverGeminiTask(input: {
  chineseTitle: string;
  englishMonthYear: string;
  chinesePublicationDate: string;
}): string {
  const title = String(input.chineseTitle || "").trim().slice(0, 80);
  return `
You are a bilingual (English and Simplified Chinese) elite magazine art director and prompt engineer.

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** only receives **your English output** and paints pixels—it **cannot** translate or interpret the Chinese title by itself. You MUST read the Chinese title and publication hints below and output **ONLY ONE** final **English** prompt string that already encodes all layout, materials, and **Simplified-Chinese** hero typography requirements (stated in English for the image model).
**Execution-first:** prioritize **numbered, concrete directives** (scene / light / typography zone / Chinese glyph specs) so GPT-Image-2 can render without guessing; Chinese is reference for in-image text content only.

Read the Chinese report title and publication hints, then output ONLY ONE final English prompt string for GPT-IMAGE-2.

MANDATORY RULES FOR YOUR OUTPUT PROMPT:
1. START WITH a **premium editorial magazine cover** opener tailored to the Chinese title mood—**9:16 vertical portrait**, cinematic editorial photography, masterpiece print quality. **Strongly recommended palette:** let the title/context drive light and color (daylight, soft overcast, warm interior, or restrained dark-gold **only when the brief supports it**). **Not recommended:** defaulting every cover to heavy dark-gold / low-key gloom without narrative reason.
2. SCENE: Describe layout, lighting, textures, and luxury materials in vivid English only for non-text regions.
3. CRITICAL TYPOGRAPHY (SIMPLIFIED CHINESE ONLY): **Strongly recommended** to include this requirement: "All masthead lines, hero headline, and every readable word on the cover should be in Simplified Chinese only (no Traditional Chinese). Bake the following Chinese string as the main cover headline, large and legible: 「${title}」. Optional tiny corner line in English may show only the masthead date token: ${input.englishMonthYear}. If any secondary Chinese tagline is needed, use Simplified Chinese (e.g. 战略情报)."
4. Add publication context in English for the model only: "Chinese publication calendar note: ${input.chinesePublicationDate}."
5. OUTPUT: Output ONLY the English prompt string. No explanations.

[Chinese title]: ${title}
`.trim();
}

/** GodView 章节扉页：双语编导读中文 → 一条英文视觉 prompt；GPT-IMAGE-2 无翻译能力 */
export function buildChapterPosterGeminiTask(chineseTitle: string, chineseContext: string): string {
  const t = String(chineseTitle || "").trim().slice(0, 120);
  const c = String(chineseContext || "").trim().slice(0, 2000);
  return `
You are a bilingual (English and Simplified Chinese) art director and strategic visual translator.

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** sees **only** your **English** prompt—**not** the Chinese passage. You MUST distill the Chinese title and passage into **one** self-contained **English** visual prompt, with hero **Simplified-Chinese** lines specified via explicit English instructions to the image model.
**Execution-first:** lock **layout, lighting, and on-image Chinese type specs** in plain English **before** any lyrical phrasing.

Output ONLY ONE English prompt for GPT-IMAGE-2.

MANDATORY RULES:
1. START WITH a **premium strategic intelligence chapter poster**, **9:16 vertical**, cinematic editorial, museum-grade lighting. **Palette:** follow the Chinese passage—**recommended** varied light (daylight / soft interior / selective dark accent) rather than default dark-gold and ink for every poster.
2. Describe visual scene in English; all prominent typography on the poster **should be** Simplified Chinese only. Hero title **strongly recommended** to include exactly: 「${t}」.
3. Summarize supporting context from the Chinese passage into English visual staging cues only (do not paste the Chinese paragraph as unreadable microtext). Chinese passage for your analysis:\n${c}
4. OUTPUT: English prompt only, no chitchat.
`.trim();
}

/**
 * 战略封面 / 章节扉页：**Vertex Global · gemini-3.1-pro-preview** 双语编导 → 一条英文视觉 prompt。
 */
export async function runGemini31ProPreviewText(userTask: string): Promise<string> {
  const { callGemini3_1_Pro } = await import("./vertexGemini31ProGlobal.js");
  const raw = await callGemini3_1_Pro(userTask);
  const out = stripGeminiModelOutput(raw);
  if (!out) {
    throw new Error("封面指令返回空内容");
  }
  return out;
}
