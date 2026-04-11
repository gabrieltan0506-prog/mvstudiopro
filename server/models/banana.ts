import { generateGeminiImage } from "../gemini-image";

export async function generateStoryboardSceneImages(input: {
  scenePrompt: string;
  count?: number;
}) {
  const scenePrompt = String(input.scenePrompt || "").trim();
  const count = Math.max(1, Math.min(3, Number(input.count || 2)));

  if (!scenePrompt) {
    return {
      imageUrls: [] as string[],
      provider: "vertex",
      model: "imagen-4.0-generate",
      isFallback: true,
      errorMessage: "scenePrompt is required",
    };
  }

  try {
    const imageUrls: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const result = await generateGeminiImage({
        prompt: `${scenePrompt}\n版本提示：生成第 ${index + 1} 张分镜参考图，保持主体一致，适合 16:9 视频分镜。`,
        quality: "1k",
      });
      imageUrls.push(result.imageUrl);
    }

    return {
      imageUrls,
      provider: "vertex",
      model: "imagen-4.0-generate",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      imageUrls: [] as string[],
      provider: "vertex",
      model: "imagen-4.0-generate",
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}
