/**
 * 默认：Stage2 = OpenAI，平台图 = Fly 卷。
 * 对照其它栈：`PLATFORM_STAGE2_LLM=vertex`；`PLATFORM_IMAGE_STORAGE=gcs`。
 * 换 OpenAI 模型：`PLATFORM_STAGE2_OPENAI_MODEL`（默认 gpt-5.5）。
 *
 * **緊急避險：** 僅在需關閉 Vertex/平台 GCS 時，將 {@link PLATFORM_USE_GOOGLE_GCP} 設為 `false`，或設 `PLATFORM_WEEKEND_ESCAPE=1`（預設允許 GCP，與語音等其它 Google 能力無關）。
 *
 * **週末生存模式：** {@link PLATFORM_WEEKEND_SURVIVAL_MODE} 為 `true` 時，等同開啟平台 GCP 避險（Stage2→OpenAI、gpt‑5.5、 Fly 存圖、英文化不調 Vertex）。帳單恢復後請改回 `false`。
 */

export type PlatformStage2LlmMode = "openai" | "vertex";
export type PlatformImageStorageDriver = "fly" | "gcs";

/** 🚨 鎖定 OpenAI + Fly 平台鏈路；並令 {@link isPlatformWeekendGcpEscape} 為真。 */
export const PLATFORM_WEEKEND_SURVIVAL_MODE = true;

function norm(s: string | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * **主開關：** `true` = 平台 Stage2/存圖/英文化兜底可按 env 走 Vertex·GCS；`false` = 強制避險（OpenAI+Fly、跳 Vertex 生圖兜底等）。與語音辨識等獨立服務無關。
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
  if (PLATFORM_WEEKEND_SURVIVAL_MODE) return true;
  if (!PLATFORM_USE_GOOGLE_GCP) return true;
  if (PLATFORM_WEEKEND_GCP_ESCAPE) return true;
  const billing = norm(process.env.GCP_BILLING_STATUS);
  if (billing === "suspended" || billing === "suspension") return true;
  const esc = norm(process.env.PLATFORM_WEEKEND_ESCAPE);
  return esc === "1" || esc === "true" || esc === "yes";
}

export function resolvePlatformStage2LlmMode(): PlatformStage2LlmMode {
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

export function resolvePlatformImageStorageDriver(): PlatformImageStorageDriver {
  if (isPlatformWeekendGcpEscape()) return "fly";
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

  return "fly";
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
