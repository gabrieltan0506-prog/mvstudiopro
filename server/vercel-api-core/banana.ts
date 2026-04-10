import { generateGeminiImage } from "../gemini-image";

export interface BananaGenerateInput {
  prompt: string;
  numImages?: number;
  aspectRatio?: string;
  imageSize?: string;
}

export interface BananaGenerateResult {
  imageUrls: string[];
  provider: "vertex";
  model: "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";
}

export async function generateImageWithBanana(input: BananaGenerateInput): Promise<BananaGenerateResult> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required");
  }

  const numImages = Math.max(1, Math.min(3, Number(input.numImages || 1)));
  const quality = String(input.imageSize || "").trim().toUpperCase() === "1K" ? "1k" : "2k";
  const imageUrls: string[] = [];

  for (let index = 0; index < numImages; index += 1) {
    const result = await generateGeminiImage({
      prompt: `${prompt}\n第 ${index + 1} 张，保持主体与风格一致。`,
      quality: quality as "1k" | "2k",
    });
    imageUrls.push(result.imageUrl);
  }

  return {
    imageUrls,
    provider: "vertex",
    model: quality === "1k" ? "gemini-2.5-flash-image" : "gemini-3-pro-image-preview",
  };
}
