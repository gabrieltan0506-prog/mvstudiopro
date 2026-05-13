/**
 * 默认：Stage2 = OpenAI，**平台图 = GCS**（`PLATFORM_IMAGE_STORAGE` 未设或設為 `gcs`）。
 * 暫時改回 Fly 卷：僅當 **`PLATFORM_IMAGE_STORAGE=fly`**（或 `MV_PLATFORM_IMAGE_STORAGE`，值 `fly`/`volume`/`fly_volume`）。**已廢止**沿用 `PLATFORM_TOPIC_IMAGE_USE_FLY_VOLUME`。
 * 换 OpenAI 模型：`PLATFORM_STAGE2_OPENAI_MODEL`（默认 gpt-5.5）。
 *
 * **Vertex Stage 2 暫停：** {@link PLATFORM_STAGE2_VERTEX_TEMPORARILY_DISABLED} 為 `true` 時，`buildPlatformContent` 一律 **OpenAI**，忽略 `PLATFORM_STAGE2_LLM=vertex`。Vertex 恢復後請設 `PLATFORM_STAGE2_VERTEX_AVAILABLE=1`，或將該常數改 `false`。
 *
 * **緊急避險：** 僅在需關閉 Vertex/平台 GCS 時，將 {@link PLATFORM_USE_GOOGLE_GCP} 設為 `false`，或設 `PLATFORM_WEEKEND_ESCAPE=1`（預設允許 GCP，與語音等其它 Google 能力無關）。
 *
 * **週末生存模式（可切換）：佈署環境變數 `PLATFORM_WEEKEND_SURVIVAL_MODE=1`（或 `true`/`yes`/`on`）時啟用**，等同開啟平台 GCP 避險（Stage2→OpenAI、2×4 英文化鎖 GPT 5.4 等）。**未設定或非 truthy 時預設關閉**，2×4 可走 Vertex Flash 與面板 translator。見 {@link isPlatformWeekendSurvivalModeEnabled}。**存圖驅動**仍依 {@link resolvePlatformImageStorageDriver}：預設 **GCS**，暫回 Fly 請設 `PLATFORM_IMAGE_STORAGE=fly`。
 *
 * **Vertex Flash 英文化關閉（代碼保留）：** 設 `PLATFORM_VERTEX_FLASH_TRANSLATION=0`（或 `false`/`off`）或 `PLATFORM_VERTEX_FLASH_TRANSLATION_OFF=1`，則不調 Vertex Flash 譯英文／兜底；見 {@link isPlatformVertexFlashTranslationEnabled}。
 */

export type PlatformStage2LlmMode = "openai" | "vertex";
export type PlatformImageStorageDriver = "fly" | "gcs";

function norm(s: string | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * 週末／帳單避險 **生存模式**：由環境變數 **`PLATFORM_WEEKEND_SURVIVAL_MODE`** 切換（dual mode）。
 * - **開啟**：`1` / `true` / `yes` / `on` → 觸發 {@link isPlatformWeekendGcpEscape} 內整鏈避險（含 2×4 英文化鎖 GPT 5.4）。
 * - **關閉**：未設定、`0` / `false` / `no` / `off` → **預設**，可走 Vertex Flash 與面板 translator。
 */
export function isPlatformWeekendSurvivalModeEnabled(): boolean {
  const v = norm(process.env.PLATFORM_WEEKEND_SURVIVAL_MODE);
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return false;
}

/**
 * Vertex / Gemini 3.1 Pro（Stage 2 長文鏈）暫不可用時為 `true`，強制 Stage2 → OpenAI。
 * 下週 Vertex 就緒後改 `false`，或保持 `true` 並設環境變數 `PLATFORM_STAGE2_VERTEX_AVAILABLE=1` 放行 vertex 模式。
 */
export const PLATFORM_STAGE2_VERTEX_TEMPORARILY_DISABLED = true;

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

  return "openai";
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

  /** 已廢止：不再讀取 PLATFORM_TOPIC_IMAGE_USE_FLY_VOLUME——曾導致 production 僅設舊旗標就改走 Fly 卷、簽名讀鏈與下載行為與 GCS 不一致。若確需 Fly 卷，必須明確設 PLATFORM_IMAGE_STORAGE=fly。 */
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
