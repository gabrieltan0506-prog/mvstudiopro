
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

export async function translateToEnglish(text: string, options?: TranslateOptions): Promise<string> {
  const maxChars = Math.max(80, Number(options?.maxChars || 420));
  const src = toSingleLine(text);
  if (!src) return "";

  // Skip translation for already-English prompts.
  if (!hasCjk(src)) return normalizeOutput(src, maxChars);

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return fallbackEnglishPrompt(src, maxChars);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
    if (!translated) return fallbackEnglishPrompt(src, maxChars);
    return normalizeOutput(translated, maxChars);
  } catch (_e) {
    return fallbackEnglishPrompt(src, maxChars);
  }
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
