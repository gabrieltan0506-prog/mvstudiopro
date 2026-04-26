/**
 * OpenAI GPT-image-1 image generation
 * Called as "GPT-image-2" in the UI per product naming.
 */

export type GptImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export interface GptImageInput {
  prompt: string;
  n?: number;
  size?: GptImageSize;
  quality?: "standard" | "high";
}

export interface GptImageResult {
  imageUrls: string[];
  provider: "openai";
  model: "gpt-image-1";
}

export async function generateGptImage(input: GptImageInput): Promise<GptImageResult> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");

  const n = Math.max(1, Math.min(4, Number(input.n || 1)));
  const size: GptImageSize = input.size || "1024x1024";
  const quality = input.quality || "standard";

  const body: Record<string, unknown> = {
    model: "gpt-image-1",
    prompt,
    n,
    size,
    quality,
  };

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI image API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const items: Array<{ url?: string; b64_json?: string }> = Array.isArray(json?.data) ? json.data : [];

  const imageUrls: string[] = items
    .map((item) => {
      if (item.url) return item.url;
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      return "";
    })
    .filter(Boolean);

  if (imageUrls.length === 0) {
    throw new Error(`GPT-image-1: no images in response. raw: ${JSON.stringify(json).slice(0, 300)}`);
  }

  return { imageUrls, provider: "openai", model: "gpt-image-1" };
}

/** Map aspect ratio strings like "16:9" or "9:16" to supported GPT-image-1 sizes */
export function aspectRatioToGptImageSize(aspectRatio?: string): GptImageSize {
  const ar = String(aspectRatio || "").trim();
  if (ar === "9:16" || ar === "portrait") return "1024x1536";
  if (ar === "16:9" || ar === "landscape") return "1536x1024";
  if (ar === "3:4") return "1024x1536";
  return "1024x1024";
}
