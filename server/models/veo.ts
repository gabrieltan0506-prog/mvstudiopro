import { generateVideo } from "../veo";

function sanitizeVideoPrompt(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[【】]/g, "")
    .trim()
    .slice(0, 700);
}

export async function generateVideoWithVeo(input: {
  scenePrompt: string;
  referenceImages: string[];
  imageUrls: string[];
}) {
  const scenePrompt = sanitizeVideoPrompt(String(input.scenePrompt || "").trim());

  if (!scenePrompt) {
    return {
      videoUrl: "",
      provider: "vertex",
      model: "veo-3.1-generate-001",
      isFallback: true,
      errorMessage: "scenePrompt is required",
    };
  }

  const images = Array.from(
    new Set([...(input.referenceImages || []), ...(input.imageUrls || [])].map((value) => String(value || "").trim())),
  ).filter(Boolean).slice(0, 3);

  if (!images.length) {
    return {
      videoUrl: "",
      provider: "vertex",
      model: "veo-3.1-generate-001",
      isFallback: true,
      errorMessage: "reference image is required",
    };
  }

  try {
    const result = await generateVideo({
      prompt: scenePrompt,
      imageUrl: images[0],
      quality: "standard",
      aspectRatio: "16:9",
      resolution: "720p",
      negativePrompt: "multiple people, extra limbs, animal, pet, duplicate subject, distorted face",
    });

    return {
      videoUrl: result.videoUrl,
      provider: "vertex",
      model: "veo-3.1-generate-001",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      videoUrl: "",
      provider: "vertex",
      model: "veo-3.1-generate-001",
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}
