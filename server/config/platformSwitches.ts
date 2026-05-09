/**
 * 默认：Stage2 = OpenAI，平台图 = Fly 卷。
 * 对照其它栈：`PLATFORM_STAGE2_LLM=vertex`；`PLATFORM_IMAGE_STORAGE=gcs`。
 * 换 OpenAI 模型：`PLATFORM_STAGE2_OPENAI_MODEL`（默认 gpt-5.5）。
 */

export type PlatformStage2LlmMode = "openai" | "vertex";
export type PlatformImageStorageDriver = "fly" | "gcs";

function norm(s: string | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

export function resolvePlatformStage2LlmMode(): PlatformStage2LlmMode {
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

export function getPlatformStage2OpenAiModel(): string {
  const m = String(process.env.PLATFORM_STAGE2_OPENAI_MODEL || "gpt-5.5").trim();
  return m || "gpt-5.5";
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

  return "fly";
}
