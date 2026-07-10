/**
 * 默认：Creator Growth **Stage 1 战略看板** 与 **Stage 2 全案文案** = **OhMyGPT GPT‑5.6 Sol**（失败回退 **gpt-5.6-terra**）。**平台选题生图** = **EvoLink gpt-image-2**（中文直送；封面 / 2×4）。**平台图 = GCS**。
 * 输出上限：文案 **64K**（`GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS` / `PLATFORM_STAGE2_MAX_OUTPUT_TOKENS`）。
 * 暫時改回 Fly 卷：設 `PLATFORM_IMAGE_STORAGE=fly`。Gemini 文案退路：設 `PLATFORM_STAGE2_LLM=vertex`。对照：`PLATFORM_IMAGE_STORAGE=gcs`。
 * 文案模型：`PLATFORM_STAGE2_OPENAI_MODEL` / `OHMYGPT_GPT56_SOL_MODEL`（默认 `gpt-5.6-sol`）；Terra 退路：`OHMYGPT_GPT56_TERRA_MODEL`（默认 `gpt-5.6-terra`）。
 *
 * **Vertex Stage 2 暫停：** {@link PLATFORM_STAGE2_VERTEX_TEMPORARILY_DISABLED} 為 `true` 時，`buildPlatformContent` 一律 **OpenAI**，忽略 `PLATFORM_STAGE2_LLM=vertex`。Vertex 恢復後請設 `PLATFORM_STAGE2_VERTEX_AVAILABLE=1`，或將該常數改 `false`。
 *
 * **緊急避險：** 僅在需關閉 Vertex/平台 GCS 時，將 {@link PLATFORM_USE_GOOGLE_GCP} 設為 `false`，或設 `PLATFORM_WEEKEND_ESCAPE=1`（預設允許 GCP，與語音等其它 Google 能力無關）。
 *
 * **週末生存模式：** 當 {@link PLATFORM_WEEKEND_SURVIVAL_MODE_FORCE_OFF} 為 `true` 時**程式強制關閉**，不再讀 `PLATFORM_WEEKEND_SURVIVAL_MODE`。設為 `false` 後，佈署變數 `PLATFORM_WEEKEND_SURVIVAL_MODE=1`（或 `true`/`yes`/`on`）可再啟用，等同平台 GCP 避險（Stage2→OpenAI、2×4 英文化鎖 GPT 5.4 等）。**存圖驅動**仍依 {@link resolvePlatformImageStorageDriver}：預設 **GCS**，暫回 Fly 請設 `PLATFORM_IMAGE_STORAGE=fly`。
 *
 * **Vertex Flash 英文化關閉（代碼保留）：** 設 `PLATFORM_VERTEX_FLASH_TRANSLATION=0`（或 `false`/`off`）或 `PLATFORM_VERTEX_FLASH_TRANSLATION_OFF=1`，則不調 Vertex Flash 譯英文／兜底；見 {@link isPlatformVertexFlashTranslationEnabled}。
 */

import { getOhMyGptGpt56SolModel } from "../services/ohmygptChat.js";

export type PlatformStage2LlmMode = "openai" | "vertex";
export type PlatformImageStorageDriver = "fly" | "gcs";

function norm(s: string | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * **`true`**：忽略 `PLATFORM_WEEKEND_SURVIVAL_MODE`，生存模式一律關閉（{@link isPlatformWeekendSurvivalModeEnabled} 恒為 `false`）。
 * 緊急需再起用時改為 `false` 並部署，再靠環境變數切換。
 */
export const PLATFORM_WEEKEND_SURVIVAL_MODE_FORCE_OFF = true;

/**
 * 週末／帳單避險 **生存模式**：預設由環境變數 **`PLATFORM_WEEKEND_SURVIVAL_MODE`** 切換；若 {@link PLATFORM_WEEKEND_SURVIVAL_MODE_FORCE_OFF} 為 `true` 則永久關閉直至改程式。
 * - **開啟**：`1` / `true` / `yes` / `on` → 觸發 {@link isPlatformWeekendGcpEscape} 內整鏈避險（含 2×4 英文化鎖 GPT 5.4）。
 * - **關閉**：未設定、`0` / `false` / `no` / `off` → **預設**，可走 Vertex Flash 與面板 translator。
 */
export function isPlatformWeekendSurvivalModeEnabled(): boolean {
  if (PLATFORM_WEEKEND_SURVIVAL_MODE_FORCE_OFF) return false;
  const v = norm(process.env.PLATFORM_WEEKEND_SURVIVAL_MODE);
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return false;
}

/**
 * Vertex / Gemini Stage 2 關閉時為 `true`，強制 Stage2 → OpenAI（應急）。
 * 正常運維請維持 `false`；若單獨關閉可改 `true` 並視需要設 `PLATFORM_STAGE2_VERTEX_AVAILABLE=1`。
 */
export const PLATFORM_STAGE2_VERTEX_TEMPORARILY_DISABLED = false;

/**
 * **主開關：** `true` = 平台 Stage2/存圖/英文化兜底可按 env 走 Vertex·GCS；`false` = 強制避險（OpenAI 等；存圖見 `PLATFORM_IMAGE_STORAGE`）。與語音辨識等獨立服務無關。
 */
export const PLATFORM_USE_GOOGLE_GCP = true;

/**
 * 在 {@link PLATFORM_USE_GOOGLE_GCP} 為 `true` 時，仍可單獨用此常數或環境變數觸發避險。
 */
export const PLATFORM_WEEKEND_GCP_ESCAPE = false;

/**
 * Vertex **Nano Banana 2**（`generateGeminiImage` 生圖兜底）代碼默認關閉。
 * 路徑恢復可用時：設環境變數 `PLATFORM_VERTEX_NANO_BANANA2=1`，或改此常數為 `true`。
 * {@link isPlatformWeekendGcpEscape} 為真時仍會關閉（與本項無關的其它 GCP 可繼續用）。
 */
export const PLATFORM_VERTEX_NANO_BANANA2_ENABLED = false;

/** 是否允許在 GPT-IMAGE-2 失敗後調用 Vertex Nano Banana 2。 */
export function isPlatformVertexNanoBanana2FallbackEnabled(): boolean {
  if (isPlatformWeekendGcpEscape()) return false;
  const v = norm(process.env.PLATFORM_VERTEX_NANO_BANANA2);
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return PLATFORM_VERTEX_NANO_BANANA2_ENABLED;
}

/**
 * 監管／請求：**選題豎封** 像素引擎（**優先於**下方 env {@link resolvePlatformTopicCoverPixelEngine}）。
 *
 * **`gpt_image2`：** **EvoLink** `gpt-image-2`（需 `EVOLINK_API_KEY`）→ OhMyGPT / fal 退路。**部署 EvoLink 密钥后默认竖封走 GPT‑Image‑2**（见 {@link resolvePlatformTopicCoverPixelEngine}）。
 * 显式启用：设 `PLATFORM_TOPIC_COVER_PIXEL_ENGINE=gpt_image2`（或 `gpt-image-2` 等别名），或请求传 `coverPixelEngine: "gpt_image2"`。
 */
export type PlatformTopicCoverPixelEngineChoice = "gpt_image2" | "nano_banana_2" | "nano_banana_pro";

export function parsePlatformTopicCoverPixelEngineChoice(
  v: unknown,
): PlatformTopicCoverPixelEngineChoice | undefined {
  const s = String(v ?? "").trim();
  if (s === "gpt_image2" || s === "nano_banana_2" || s === "nano_banana_pro") return s;
  return undefined;
}

/** 監管入參：`topicCoverPixelEngine` 優先；舊 `coverProEngine` 別名仍映射為 `nano_banana_2`。 */
export function resolveSupervisorTopicCoverPixelEngineInput(input: {
  topicCoverPixelEngine?: PlatformTopicCoverPixelEngineChoice;
  coverProEngine?: "nano_banana_2" | "nano_banana_pro";
}): PlatformTopicCoverPixelEngineChoice | undefined {
  const pick = parsePlatformTopicCoverPixelEngineChoice(input.topicCoverPixelEngine);
  if (pick) return pick;
  if (input.coverProEngine === "nano_banana_2" || input.coverProEngine === "nano_banana_pro") {
    return "nano_banana_2";
  }
  return undefined;
}

/**
 * 選題 **單幀豎封** env 預設像素（無請求覆寫 {@link PlatformTopicCoverPixelEngineChoice} 時）。
 *
 * - **`gpt_image2_only`**：**EvoLink GPT‑Image‑2**（`EVOLINK_API_KEY` 存在且未显式设 env 时的**默认**）→ OhMyGPT → fal。
 * - **`nb2_only`**：Vertex **Nano Banana 2** · 9:16 · 2K（无 EvoLink 密钥时的默认）。
 * - **`nbp_only`**：Vertex **Nano Banana Pro**（`generatePlatformTopicCoverNanoBananaProImage`）。
 * - 歷史 **Imagen / `auto` / `dual`**：視為 **`nb2_only`**（不再走 Imagen）。
 *
 * `PLATFORM_TOPIC_COVER_PIXEL_ENGINE`：`gpt_image2` | `gpt-image-2` | `ohmygpt` | `nb2` | `nb2_only` | … | `nbp_only` | …
 */
export type PlatformTopicCoverPixelEngineMode = "gpt_image2_only" | "nb2_only" | "nbp_only";

export function resolvePlatformTopicCoverPixelEngine(): PlatformTopicCoverPixelEngineMode {
  const v = norm(process.env.PLATFORM_TOPIC_COVER_PIXEL_ENGINE);
  /** 歷史 Imagen／auto：主產品改走 NB2。 */
  if (
    v === "imagen_then_nb2" ||
    v === "imagen_nb2" ||
    v === "imagen+nb2" ||
    v === "dual" ||
    v === "auto" ||
    v === "imagen_only" ||
    v === "imagen_ultra_only" ||
    v === "imagen"
  ) {
    return "nb2_only";
  }
  if (
    v === "gpt_image2_only" ||
    v === "gpt_image2" ||
    v === "gpt-image-2" ||
    v === "gptimage2" ||
    v === "ohmygpt" ||
    v === "openai_image"
  ) {
    return "gpt_image2_only";
  }
  if (
    v === "nbp_only" ||
    v === "nbp" ||
    v === "nano_banana_pro" ||
    v === "vertex_pro" ||
    v === "banana_pro"
  ) {
    return "nbp_only";
  }
  if (
    v === "nb2_only" ||
    v === "nb2" ||
    v === "nano_banana2" ||
    v === "vertex_nb2" ||
    v === "vertex"
  ) {
    return "nb2_only";
  }
  /** 未显式设定：有 EvoLink 密钥则默认 GPT-Image-2 竖封；否则 Nano Banana 2。 */
  if (String(process.env.EVOLINK_API_KEY || "").trim()) {
    return "gpt_image2_only";
  }
  return "nb2_only";
}

/**
 * 平台頁 **2×4 / 八格** 合成出圖主引擎。
 * - **`nano_banana_2`（程式預設）**：**僅** Vertex **Nano Banana 2**（16:9·2K），略過 GPT‑Image‑2。
 * - **`gpt_image2`**：保留相容；**OhMyGPT** → **fal** GPT‑Image‑2 → 可選 NB2 兜底（需環境顯式設 `PLATFORM_COMPOSITE_SHEET_ENGINE=gpt_image2`）。
 *
 * 部署：`PLATFORM_COMPOSITE_SHEET_ENGINE=nano_banana_2` 或 `gpt_image2`（別名含 `gpt-image-2`、`nb2`、`vertex`）。
 *
 * **請求覆寫：** 前端或 worker 可傳 `compositeImageEngine`；若為 `gpt_image2` / `nano_banana_2` 則 **優先於** 環境變數（但見 {@link PLATFORM_COMPOSITE_SHEET_GPT_IMAGE2_TEMPORARILY_DISABLED}）。
 */
export type PlatformCompositeSheetImageEngine = "gpt_image2" | "nano_banana_2";

/** 未設 `PLATFORM_COMPOSITE_SHEET_ENGINE`、且無請求覆寫時的預設：Vertex Nano Banana 2（暫停 GPT‑Image‑2 主鏈）。 */
export const PLATFORM_COMPOSITE_SHEET_ENGINE_DEFAULT: PlatformCompositeSheetImageEngine = "nano_banana_2";

/**
 * **`false`（当前）**：尊重 UI / 请求中的 `compositeImageEngine`（`gpt_image2` | `nano_banana_2`）。
 */
export const PLATFORM_COMPOSITE_SHEET_GPT_IMAGE2_TEMPORARILY_DISABLED = false;

export function resolvePlatformCompositeSheetImageEngine(
  requested?: PlatformCompositeSheetImageEngine | null,
): PlatformCompositeSheetImageEngine {
  if (PLATFORM_COMPOSITE_SHEET_GPT_IMAGE2_TEMPORARILY_DISABLED) {
    return "nano_banana_2";
  }
  if (requested === "gpt_image2" || requested === "nano_banana_2") {
    return requested;
  }
  const v = norm(process.env.PLATFORM_COMPOSITE_SHEET_ENGINE);
  if (
    v === "gpt_image2" ||
    v === "gpt-image-2" ||
    v === "gptimage2" ||
    v === "openai" ||
    v === "ohmygpt"
  ) {
    return "gpt_image2";
  }
  if (
    v === "nano_banana_2" ||
    v === "nano-banana-2" ||
    v === "nanobanana2" ||
    v === "nb2" ||
    v === "vertex"
  ) {
    return "nano_banana_2";
  }
  return PLATFORM_COMPOSITE_SHEET_ENGINE_DEFAULT;
}

/**
 * 平台 **生圖前置鏈**（`extractChineseVisualBrief`、Vertex 失敗後的 GPT 英文化兜底等）是否允許呼叫 **OpenAI**。
 * 預設 **false**（無額度時零 OpenAI）。設 `PLATFORM_IMAGE_ALLOW_OPENAI=1`（或 `true`/`yes`/`on`）恢復舊兜底。
 */
export function isPlatformImageOpenAiAllowed(): boolean {
  // 配置 EVOLINK_API_KEY 時自動啟用（Evolink 為 OpenAI 相容端點）
  if (String(process.env.EVOLINK_API_KEY || "").trim()) return true;
  const v = norm(process.env.PLATFORM_IMAGE_ALLOW_OPENAI);
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** 平台圖/Stage2 相關避險（關閉主開關、週末旗標、billing/環境變數）。不影響語音或其它非平台管線。 */
export function isPlatformWeekendGcpEscape(): boolean {
  if (isPlatformWeekendSurvivalModeEnabled()) return true;
  if (!PLATFORM_USE_GOOGLE_GCP) return true;
  if (PLATFORM_WEEKEND_GCP_ESCAPE) return true;
  const billing = norm(process.env.GCP_BILLING_STATUS);
  if (billing === "suspended" || billing === "suspension") return true;
  const esc = norm(process.env.PLATFORM_WEEKEND_ESCAPE);
  return esc === "1" || esc === "true" || esc === "yes";
}

/**
 * 僅讀環境變數：**Vertex Flash 英文化**（譯英文 prompt、非戰略封面）是否允許。
 * `false` = 關閉 Flash 調用（實作保留）；與 {@link isPlatformWeekendGcpEscape} 無關——後者為真時仍會整體避險。
 */
export function isPlatformVertexFlashTranslationEnvEnabled(): boolean {
  const off = norm(process.env.PLATFORM_VERTEX_FLASH_TRANSLATION_OFF);
  if (off === "1" || off === "true" || off === "yes" || off === "on") return false;
  const main = norm(process.env.PLATFORM_VERTEX_FLASH_TRANSLATION);
  if (main === "0" || main === "false" || main === "no" || main === "off") return false;
  return true;
}

/**
 * 是否允許本階段調用 **Vertex Flash** 做平台英文化（顯式選 Flash、engine=gemini31flash、GPT 三輪後兜底）。
 * `false` 當 {@link isPlatformWeekendGcpEscape} 為真，或 {@link isPlatformVertexFlashTranslationEnvEnabled} 為假。
 */
export function isPlatformVertexFlashTranslationEnabled(): boolean {
  if (isPlatformWeekendGcpEscape()) return false;
  return isPlatformVertexFlashTranslationEnvEnabled();
}

export function resolvePlatformStage2LlmMode(): PlatformStage2LlmMode {
  const vertexAvailEnv = norm(process.env.PLATFORM_STAGE2_VERTEX_AVAILABLE);
  const vertexExplicitlyOn =
    vertexAvailEnv === "1" ||
    vertexAvailEnv === "true" ||
    vertexAvailEnv === "yes" ||
    vertexAvailEnv === "on";
  if (PLATFORM_STAGE2_VERTEX_TEMPORARILY_DISABLED && !vertexExplicitlyOn) {
    return "openai";
  }
  if (isPlatformWeekendGcpEscape()) return "openai";
  const primary = norm(process.env.PLATFORM_STAGE2_LLM);
  if (primary === "openai" || primary === "gpt" || primary === "gpt55" || primary === "gpt-5.5") {
    return "openai";
  }
  if (
    primary === "vertex" ||
    primary === "google" ||
    primary === "gemini" ||
    primary === "gemini_api" ||
    primary === "vertex_ai" ||
    primary === "gcp"
  ) {
    return "vertex";
  }

  const useOpenAiFlag = norm(process.env.PLATFORM_STAGE2_USE_OPENAI);
  if (useOpenAiFlag === "1" || useOpenAiFlag === "true" || useOpenAiFlag === "yes") {
    return "openai";
  }
  if (useOpenAiFlag === "0" || useOpenAiFlag === "false" || useOpenAiFlag === "no") {
    return "vertex";
  }

  const p = norm(process.env.PLATFORM_STAGE2_LLM_PROVIDER);
  if (p === "vertex" || p === "google" || p === "vertex_ai" || p === "gcp" || p === "gemini") {
    return "vertex";
  }
  if (p === "openai" || p === "gpt") {
    return "openai";
  }

  /** 未显式指定时默认 OhMyGPT GPT‑5.6 Sol；`vertex`/`gemini` env 值走 Gemini API 退路。 */
  return "openai";
}

/**
 * Creator Growth **Stage 1 / Stage 2 全案 / 战略看板 / 深度追问 / 自定义选题文案** 主路径固定 **OhMyGPT GPT‑5.6 Sol**。  
 * Sol 报错时由 `invokeOpenAI` 自动改走同网关 **`gpt-5.6-terra`**（需 `PROXY_OPENAI_API_KEY` / `OHMYGPT_API_KEY`）。  
 * **生图仍走 EvoLink gpt-image-2**，不经本函数。Gemini 文案退路：`PLATFORM_STAGE2_LLM=vertex`。
 */
export function getPlatformStage2OpenAiModel(): string {
  return getOhMyGptGpt56SolModel();
}

/** Stage 1 / Stage 2 文案 GPT‑5.6 推理强度：默认 **medium**（与 GPT-5.5 迁移基线一致）。 */
export function resolvePlatformStage2OpenAiReasoningEffort():
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh" {
  const raw = norm(process.env.PLATFORM_STAGE2_OPENAI_REASONING_EFFORT);
  const allowed = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
  if (allowed.has(raw)) return raw as ReturnType<typeof resolvePlatformStage2OpenAiReasoningEffort>;
  return "medium";
}

/** 封面英文化 GPT‑5.4 JSON：默认 **medium**。 */
export function resolveGpt54CoverTranslationReasoningEffort():
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh" {
  const raw = norm(process.env.GPT54_COVER_TRANSLATION_REASONING_EFFORT);
  const allowed = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
  if (allowed.has(raw)) return raw as ReturnType<typeof resolveGpt54CoverTranslationReasoningEffort>;
  return "medium";
}

/** 2×4 / 八格英文化 GPT‑5.4 JSON：默认 **medium**。 */
export function resolveGpt54CompositeTranslationReasoningEffort():
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh" {
  const raw = norm(process.env.GPT54_COMPOSITE_TRANSLATION_REASONING_EFFORT);
  const allowed = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
  if (allowed.has(raw)) return raw as ReturnType<typeof resolveGpt54CompositeTranslationReasoningEffort>;
  return "medium";
}

/** 封面英文化 max_output_tokens：默认 **65536**（64K）。 */
export function resolveGpt54CoverTranslationMaxOutputTokens(): number {
  const raw = Number(process.env.GPT54_COVER_TRANSLATION_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(raw) && raw >= 4096) return Math.min(65_536, Math.floor(raw));
  const legacy = Number(process.env.GPT54_PLATFORM_IMAGE_TRANSLATION_MAX_TOKENS);
  if (Number.isFinite(legacy) && legacy >= 4096) return Math.min(65_536, Math.floor(legacy));
  return 65_536;
}

/** 2×4 / 八格英文化 max_output_tokens：默认 **65536**（64K）以生成更精细的提示词。 */
export function resolveGpt54CompositeTranslationMaxOutputTokens(): number {
  const raw = Number(process.env.GPT54_COMPOSITE_TRANSLATION_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(raw) && raw >= 4096) return Math.min(65_536, Math.floor(raw));
  return 65_536;
}

/**
 * Stage 2 OpenAI **第二階** JSON 封裝：与文案主路径一致，固定 **OhMyGPT gpt-5.6-sol**（失败则 gpt-5.6-terra）。
 */
export function getPlatformStage2StructureOpenAiModel(): string {
  return getOhMyGptGpt56SolModel();
}

/**
 * Stage 2 OpenAI **預設單階**：一次請求輸出 `json_object`。  
 * 若需 **雙階**（先創意正文再 GPT‑5.4 組裝 JSON），請設 `PLATFORM_STAGE2_OPENAI_TWO_PHASE=1`（或 `true` / `yes` / `on`）。
 */
export function isPlatformStage2OpenAiTwoPhaseEnabled(): boolean {
  const v = norm(process.env.PLATFORM_STAGE2_OPENAI_TWO_PHASE);
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return false;
}

export function resolvePlatformImageStorageDriver(): PlatformImageStorageDriver {
  const raw = norm(process.env.PLATFORM_IMAGE_STORAGE || process.env.MV_PLATFORM_IMAGE_STORAGE);
  if (raw === "fly" || raw === "volume" || raw === "fly_volume") {
    return "fly";
  }
  if (raw === "gcs" || raw === "google" || raw === "gs" || raw === "storage") {
    return "gcs";
  }

  const legacy = String(process.env.PLATFORM_TOPIC_IMAGE_USE_FLY_VOLUME || "").trim();
  if (legacy === "1") return "fly";
  if (legacy === "0") return "gcs";

  /** 預設 GCS；日後若要暫回 Fly，設 `PLATFORM_IMAGE_STORAGE=fly` 即可，無需刪除 GCS 路徑。 */
  return "gcs";
}

/** 文檔/呼叫端命名 alias，等同於 {@link resolvePlatformStage2LlmMode} */
export function getPlatformStage2Llm(): PlatformStage2LlmMode {
  return resolvePlatformStage2LlmMode();
}

/** 小寫 openai 拼寫別名 */
export function getPlatformStage2OpenaiModel(): string {
  return getPlatformStage2OpenAiModel();
}

export function getPlatformImageStorage(): PlatformImageStorageDriver {
  return resolvePlatformImageStorageDriver();
}

/**
 * **實驗：** 套裝「封面+2×4」是否允許 **2×4 側**跑步驟 0.5 Deep Research Pro（不再強制 `forceSkipCompositeDeepResearchPro`）。
 * 預設關；測試時設 `PLATFORM_BUNDLE_COMPOSITE_DR_PRO=1`（或 `true`/`yes`/`on`），並在監管端勾選套裝專用 DR。
 */
export function isPlatformBundleCompositeDrProEnabled(): boolean {
  const v = norm(process.env.PLATFORM_BUNDLE_COMPOSITE_DR_PRO);
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
