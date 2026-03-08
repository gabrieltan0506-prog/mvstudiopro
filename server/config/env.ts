export const env = {
  falKey: String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim(),
  klingVideoAccessKey: String(process.env.KLING_CN_VIDEO_ACCESS_KEY || "").trim(),
  klingVideoSecretKey: String(process.env.KLING_CN_VIDEO_SECRET_KEY || "").trim(),
  geminiApiKey: String(process.env.GEMINI_API_KEY || "").trim(),
  klingCnBaseUrl: String(process.env.KLING_CN_BASE_URL || "").trim(),
  nodeEnv: String(process.env.NODE_ENV || "").trim(),
  legacyKlingEnv: {
    KLING_ACCESS_KEY: String(process.env.KLING_ACCESS_KEY || "").trim(),
    KING_ACCESS_KEY: String(process.env.KING_ACCESS_KEY || "").trim(),
    KLINGAI_ACCESS_KEY: String(process.env.KLINGAI_ACCESS_KEY || "").trim(),
    KLINGAI_SECRET_KEY: String(process.env.KLINGAI_SECRET_KEY || "").trim(),
  },
};

export function getEnvStatus() {
  return {
    hasFalKey: Boolean(env.falKey),
    hasKlingVideoAccessKey: Boolean(env.klingVideoAccessKey),
    hasKlingVideoSecretKey: Boolean(env.klingVideoSecretKey),
    hasGeminiApiKey: Boolean(env.geminiApiKey),
  };
}
