/**
 * 默认：Creator Growth **Stage 2 文案 / 平台分析 Stage 2** = **`gemini-3.1-pro-preview`**；**选题竖封英文化** = **`gemini-2.5-pro`**（`VERTEX_GEMINI_COVER_TRANSLATION_MODEL`）。**平台图 = GCS**。
 * 暫時改回 Fly 卷：設 `PLATFORM_IMAGE_STORAGE=fly`。OpenAI 文案：設 `PLATFORM_STAGE2_LLM=openai`。对照：`PLATFORM_IMAGE_STORAGE=gcs`。
 * OpenAI 文案模型：`PLATFORM_STAGE2_OPENAI_MODEL`（默认 gpt-5.5，仅在 `PLATFORM_STAGE2_LLM=openai` 时使用）。
 *
 * **Vertex Stage 2 暫停：** {@link PLATFORM_STAGE2_VERTEX_TEMPORARILY_DISABLED} 為 `true` 時，`buildPlatformContent` 一律 **OpenAI**，忽略 `PLATFORM_STAGE2_LLM=vertex`。Vertex 恢復後請設 `PLATFORM_STAGE2_VERTEX_AVAILABLE=1`，或將該常數改 `false`。
 *
 * **緊急避險：** 僅在需關閉 Vertex/平台 GCS 時，將 {@link PLATFORM_USE_GOOGLE_GCP} 設為 `false`，或設 `PLATFORM_WEEKEND_ESCAPE=1`（預設允許 GCP，與語音等其它 Google 能力無關）。
 *
 * **週末生存模式：** 當 {@link PLATFORM_WEEKEND_SURVIVAL_MODE_FORCE_OFF} 為 `true` 時**程式強制關閉**，不再讀 `PLATFORM_WEEKEND_SURVIVAL_MODE`。設為 `false` 後，佈署變數 `PLATFORM_WEEKEND_SURVIVAL_MODE=1`（或 `true`/`yes`/`on`）可再啟用，等同平台 GCP 避險（Stage2→OpenAI、2×4 英文化鎖 GPT 5.4 等）。**存圖驅動**仍依 {@link resolvePlatformImageStorageDriver}：預設 **GCS**，暫回 Fly 請設 `PLATFORM_IMAGE_STORAGE=fly`。
 *
 * **Vertex Flash 英文化關閉（代碼保留）：** 設 `PLATFORM_VERTEX_FLASH_TRANSLATION=0`（或 `false`/`off`）或 `PLATFORM_VERTEX_FLASH_TRANSLATION_OFF=1`，則不調 Vertex Flash 譯英文／兜底；見 {@link isPlatformVertexFlashTranslationEnabled}。
 */

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
 * 監管／請求：**選題豎封** 像素三選一（**優先於**下方 env {@link resolvePlatformTopicCoverPixelEngine}）。
 * 將由後續 PR 自前端／tRPC 接入；目前僅型別供 {@link generatePlatformTopicCoverNanoBanana2FromEnglishPrompt} 使用。
 */
export type PlatformTopicCoverPixelEngineChoice = "gpt_image2" | "nano_banana_2" | "imagen_4_ultra";

/**
 * 選題 **單幀豎封** 像素：**Vertex Nano Banana 2** 與 **Gemini API · Imagen 4 Ultra**（`GEMINI_API_KEY`）並存，便於 A/B，**不刪 NB2 代碼**。
 *
 * - **`nb2_only`（預設）**：僅 NB2，行為與歷史一致。
 * - **`imagen_then_nb2`**：有 `GEMINI_API_KEY` 時先 Imagen，失敗或未配置 key 再 **完整走 NB2**。
 * - **`imagen_only`**：僅 Imagen；失敗則無圖（**不**回落 NB2）。
 *
 * `PLATFORM_TOPIC_COVER_PIXEL_ENGINE`：`nb2` | `nb2_only` | `nano_banana2` | `imagen_then_nb2` | `imagen_nb2` | `imagen+nb2` | `auto` | `imagen_only` | `imagen`
 */
export type PlatformTopicCoverPixelEngineMode = "nb2_only" | "imagen_then_nb2" | "imagen_only";

export function resolvePlatformTopicCoverPixelEngine(): PlatformTopicCoverPixelEngineMode {
  const v = norm(process.env.PLATFORM_TOPIC_COVER_PIXEL_ENGINE);
  if (
    v === "imagen_then_nb2" ||
    v === "imagen_nb2" ||
    v === "imagen+nb2" ||
    v === "dual" ||
    v === "auto"
  ) {
    return "imagen_then_nb2";
  }
  if (v === "imagen_only" || v === "imagen_ultra_only" || v === "imagen") {
    return "imagen_only";
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
 * **`true`**：平台頁 2×4／八格**一律** Nano Banana 2，忽略請求與環境中的 `gpt_image2`（暫停 GPT‑Image‑2）。
 * 恢復 GPT‑Image‑2 時改為 `false` 並重新部署。
 */
export const PLATFORM_COMPOSITE_SHEET_GPT_IMAGE2_TEMPORARILY_DISABLED = true;

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

  /** 未顯式指定時預設 Vertex（Gemini）；OpenAI 僅在 env 或管理員 {@link buildPlatformContent} 覆寫時使用。 */
  return "vertex";
}

/**
 * Creator Growth **Stage 2 長文**專用模型（`buildPlatformContent`）。  
 * 計費上 gpt‑5.5 輸入/輸出約為 gpt‑5.4 的兩倍，故 **英文化 / condense 仍預設 gpt‑5.4**（見 geminiPlatformCompositeTranslation）。
 */
export function getPlatformStage2OpenAiModel(): string {
  if (isPlatformWeekendGcpEscape()) return "gpt-5.5";
  const m = String(process.env.PLATFORM_STAGE2_OPENAI_MODEL || "gpt-5.5").trim();
  return m || "gpt-5.5";
}

/**
 * Stage 2 OpenAI **第二階** JSON 封裝：預設 gpt‑5.4（成本較低），可用 `PLATFORM_STAGE2_STRUCTURE_OPENAI_MODEL` / `OPENAI_GPT54_MODEL` 覆蓋。
 */
export function getPlatformStage2StructureOpenAiModel(): string {
  const explicit = String(process.env.PLATFORM_STAGE2_STRUCTURE_OPENAI_MODEL || "").trim();
  if (explicit) return explicit;
  const from54 = String(process.env.OPENAI_GPT54_MODEL || "gpt-5.4").trim();
  return from54 || "gpt-5.4";
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
