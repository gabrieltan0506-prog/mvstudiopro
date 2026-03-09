import { fal } from "@fal-ai/client";
import { env } from "./env.js";

export interface BananaGenerateInput {
  prompt: string;
  numImages?: number;
  aspectRatio?: string;
}

export interface BananaGenerateResult {
  imageUrls: string[];
  provider: "fal";
  model: "fal-ai/nano-banana-2";
}

export async function generateImageWithBanana(input: BananaGenerateInput): Promise<BananaGenerateResult> {
  if (!env.falKey) {
    throw new Error("FAL_KEY or FAL_API_KEY is not configured");
  }

  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required");
  }

  fal.config({ credentials: env.falKey });
  const result = (await fal.subscribe("fal-ai/nano-banana-2", {
    input: {
      prompt,
      num_images: input.numImages ?? 1,
      aspect_ratio: input.aspectRatio ?? "auto",
    },
    logs: false,
  })) as any;

  const urls: string[] = [];
  const images = result?.data?.images || result?.images || [];
  if (Array.isArray(images)) {
    for (const item of images) {
      const url = typeof item?.url === "string" ? item.url : "";
      if (url) urls.push(url);
    }
  }
  const singleUrl =
    (typeof result?.data?.image?.url === "string" && result.data.image.url) ||
    (typeof result?.image?.url === "string" && result.image.url) ||
    "";
  if (singleUrl) urls.push(singleUrl);

  if (!urls.length) {
    throw new Error("fal nano banana returned no image urls");
  }

  return {
    imageUrls: urls,
    provider: "fal",
    model: "fal-ai/nano-banana-2",
  };
}
