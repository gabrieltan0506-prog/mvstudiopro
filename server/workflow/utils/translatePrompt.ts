
type TranslateOptions = {
  maxChars?: number;
  concurrency?: number;
};

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function toSingleLine(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[，、；：]/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/[,\s]+$/g, "").trim();
}

function fallbackEnglishPrompt(text: string, maxChars: number): string {
  const asciiTokens = toSingleLine(text).replace(/[^a-zA-Z0-9,.\- ]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const base = "cinematic scene, professional lighting, high detail, 16:9 composition";
  const merged = asciiTokens ? `${base}, ${asciiTokens}` : base;
  return clip(merged, maxChars);
}

function normalizeOutput(text: string, maxChars: number): string {
  const cleaned = clip(toSingleLine(text), maxChars);
  return cleaned || fallbackEnglishPrompt(text, maxChars);
}

/**
 * 向 OpenAI 相容端點發送單次翻譯請求（封面圖 & 分鏡圖共用）。
 * Single attempt to call an OpenAI-compatible translation endpoint.
 * Returns translated string on success, or null on any failure.
 *
 * @param src       預處理後的單行輸入文字
 * @param maxChars  輸出最大字元數
 * @param apiKey    API 鑑權 key（主 key 或 Evolink key）
 * @param baseUrl   端點根路徑，例如 "https://api.openai.com/v1"
 * @param model     呼叫的模型名稱，例如 "gpt-4o-mini" 或 "gpt-5.4"
 */
async function attemptTranslateOnce(
  src: string,
  maxChars: number,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string | null> {
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              `Translate to concise English for image/video generation. Output one single-line prompt only, comma-separated phrases, no markdown, no explanations, max ${maxChars} characters.`,
          },
          { role: "user", content: src },
        ],
      }),
    });

    const j = await r.json().catch(() => null);
    const translated = String(j?.choices?.[0]?.message?.content || "").trim();
    if (!translated) return null;
    return normalizeOutput(translated, maxChars);
  } catch {
    return null;
  }
}

/**
 * 帶重試的翻譯呼叫：最多重試 maxRetries 次，全失敗回傳 null。
 * Retry wrapper: try up to maxRetries times; return null if all fail.
 */
async function translateWithRetry(
  src: string,
  maxChars: number,
  apiKey: string,
  baseUrl: string,
  model: string,
  maxRetries: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await attemptTranslateOnce(src, maxChars, apiKey, baseUrl, model);
    if (result !== null) return result;
  }
  return null;
}

/**
 * 將文字翻譯成英文圖像提示詞（封面圖 & 分鏡圖共用入口）。
 *
 * Fallback 策略（三段式）：
 *   1. 優先用主 OPENAI_API_KEY 呼叫 gpt-4o-mini，最多重試 3 次。
 *   2. 若 3 次均失敗，改用 EVOLINK_API_KEY 呼叫 Evolink OpenAI 相容端點（gpt-5.4），再重試 3 次。
 *   3. 若 Evolink 也全部失敗，拋出最終錯誤；若兩組 key 均未設定，降級回傳 ASCII 安全提示詞。
 *
 * Three-stage fallback strategy:
 *   1. Use primary OPENAI_API_KEY → gpt-4o-mini, up to 3 retries.
 *   2. On total failure, switch to EVOLINK_API_KEY → Evolink-compatible gpt-5.4, up to 3 retries.
 *   3. If Evolink also exhausted, throw final error. If neither key is set, return safe ASCII fallback.
 */
export async function translateToEnglish(text: string, options?: TranslateOptions): Promise<string> {
  const maxChars = Math.max(80, Number(options?.maxChars || 420));
  const src = toSingleLine(text);
  if (!src) return "";

  // 已是英文（不含 CJK），直接正規化輸出，無需翻譯。
  // Skip translation for already-English prompts.
  if (!hasCjk(src)) return normalizeOutput(src, maxChars);

  const primaryApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const evolinkApiKey = String(process.env.EVOLINK_API_KEY || "").trim();

  // ── 階段 1：主 OPENAI_API_KEY，gpt-4o-mini，最多 3 次 ──────────────────────
  // Stage 1: Primary OPENAI_API_KEY with gpt-4o-mini, up to 3 retries.
  if (primaryApiKey) {
    const primaryResult = await translateWithRetry(
      src,
      maxChars,
      primaryApiKey,
      "https://api.openai.com/v1",
      "gpt-4o-mini",
      3,
    );
    if (primaryResult !== null) return primaryResult;
    console.warn("[translateToEnglish] primary OPENAI_API_KEY failed 3x, switching to Evolink fallback");
  }

  // ── 階段 2：Evolink API Key，gpt-5.4（OpenAI 相容端點），最多 3 次 ──────────
  // Stage 2: EVOLINK_API_KEY with gpt-5.4 via Evolink OpenAI-compatible endpoint, up to 3 retries.
  if (evolinkApiKey) {
    const evolinkResult = await translateWithRetry(
      src,
      maxChars,
      evolinkApiKey,
      "https://api.evolink.ai/v1",
      "gpt-5.4",
      3,
    );
    if (evolinkResult !== null) return evolinkResult;
    console.warn("[translateToEnglish] EVOLINK_API_KEY also failed 3x, all retries exhausted");
  }

  // ── 階段 3：兩組 key 均未設定 → ASCII 安全降級（不中斷圖像生成鏈路）─────────
  // Stage 3a: Neither key is configured → safe ASCII fallback to avoid breaking pipeline.
  if (!primaryApiKey && !evolinkApiKey) {
    return fallbackEnglishPrompt(src, maxChars);
  }

  // ── 階段 3：有 key 但全部重試耗盡 → 拋出最終錯誤 ────────────────────────────
  // Stage 3b: Keys were present but all retries exhausted → throw final error.
  throw new Error(
    `[translateToEnglish] All retries exhausted (primary ×3 + Evolink ×3). Unable to translate: "${src.slice(0, 80)}${src.length > 80 ? "…" : ""}"`,
  );
}

export async function translatePromptsToEnglish(prompts: string[], options?: TranslateOptions): Promise<string[]> {
  const maxChars = Math.max(80, Number(options?.maxChars || 420));
  const concurrency = Math.max(1, Number(options?.concurrency || 3));
  const src = Array.isArray(prompts) ? prompts.map((x) => String(x || "")) : [];
  if (!src.length) return [];

  const cache = new Map<string, string>();
  const out = new Array<string>(src.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= src.length) return;
      const raw = src[idx];
      const key = toSingleLine(raw);
      if (!key) {
        out[idx] = "";
        continue;
      }
      if (cache.has(key)) {
        out[idx] = String(cache.get(key) || "");
        continue;
      }
      const translated = await translateToEnglish(key, { maxChars });
      cache.set(key, translated);
      out[idx] = translated;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, src.length) }, () => worker()));
  return out;
}
