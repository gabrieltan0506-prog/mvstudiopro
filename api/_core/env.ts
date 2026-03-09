export const env = {
  falKey: String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim(),
  klingVideoAccessKey: String(process.env.KLING_CN_VIDEO_ACCESS_KEY || "").trim(),
  klingVideoSecretKey: String(process.env.KLING_CN_VIDEO_SECRET_KEY || "").trim(),
  geminiApiKey: String(process.env.GEMINI_API_KEY || "").trim(),
  openaiApiKey: String(process.env.OPENAI_API_KEY || "").trim(),
};

export function getEnvStatus() {
  return {
    hasFalKey: Boolean(env.falKey),
    hasKlingVideoAccessKey: Boolean(env.klingVideoAccessKey),
    hasKlingVideoSecretKey: Boolean(env.klingVideoSecretKey),
    hasGeminiApiKey: Boolean(env.geminiApiKey),
    hasOpenAIKey: Boolean(env.openaiApiKey),
  };
}
