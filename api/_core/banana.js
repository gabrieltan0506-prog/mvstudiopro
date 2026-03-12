import { fal } from "@fal-ai/client";
import { env } from "./env.js";
async function generateImageWithBanana(input) {
  if (!env.falKey) {
    throw new Error("FAL_KEY or FAL_API_KEY is not configured");
  }
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required");
  }
  fal.config({ credentials: env.falKey });
  const imageSize = String(input.imageSize || "").trim() || "1536x864";
  const result = await fal.subscribe("fal-ai/nano-banana-2", {
    input: {
      prompt,
      num_images: input.numImages ?? 1,
      aspect_ratio: input.aspectRatio ?? "auto",
      // Default storyboard/image generation target for MVStudioPro.
      // Keep 16:9 quality high while leaving room for future paid upscale.
      image_size: imageSize
    },
    logs: false
  });
  const urls = [];
  const images = result?.data?.images || result?.images || [];
  if (Array.isArray(images)) {
    for (const item of images) {
      const url = typeof item?.url === "string" ? item.url : "";
      if (url) urls.push(url);
    }
  }
  const singleUrl = typeof result?.data?.image?.url === "string" && result.data.image.url || typeof result?.image?.url === "string" && result.image.url || "";
  if (singleUrl) urls.push(singleUrl);
  if (!urls.length) {
    throw new Error("fal nano banana returned no image urls");
  }
  return {
    imageUrls: urls,
    provider: "fal",
    model: "fal-ai/nano-banana-2"
  };
}
export {
  generateImageWithBanana
};
