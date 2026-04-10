import { generateVideo } from "../veo";

export async function veoReferenceVideo(input: {
  prompt: string;
  reference_images: string[];
  duration?: "8s" | "9s" | "10s" | number;
  resolution?: "720p" | "1080p";
}): Promise<{ videoUrl: string }> {
  const prompt = String(input.prompt || "").trim();
  const referenceImages = Array.isArray(input.reference_images)
    ? input.reference_images.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  if (!prompt) throw new Error("prompt is required");
  if (!referenceImages.length) throw new Error("reference_images is required");

  const result = await generateVideo({
    prompt,
    imageUrl: referenceImages[0],
    quality: "standard",
    aspectRatio: "16:9",
    resolution: input.resolution || "720p",
    negativePrompt: "multiple people, extra limbs, animal, pet, duplicate subject, distorted face",
  });

  if (!result.videoUrl) throw new Error("vertex veo returned empty video url");
  return { videoUrl: result.videoUrl };
}
