/**
 * v1: extremely simple storyboard generator:
 * - split user text into 6 shots (fixed) for 8s each.
 * You can later replace this with LLM-based storyboard/script generator.
 */
export function generateStoryboard(input: { text: string }) {
  const text = (input.text || "").trim();
  const shots = Array.from({ length: 6 }).map((_, i) => ({
    shotId: `shot_${i + 1}`,
    title: `镜头 ${i + 1}`,
    prompt: text ? `${text}，镜头${i + 1}，电影感，稳定构图，主体清晰` : `镜头${i + 1}，电影感，稳定构图，主体清晰`,
    refImageUrl: null as string | null,
    videoUrl: null as string | null,
    status: "queued" as "queued" | "running" | "succeeded" | "failed",
    taskId: null as string | null,
  }));
  return { shots };
}
