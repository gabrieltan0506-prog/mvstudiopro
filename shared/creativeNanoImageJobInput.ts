/**
 * Creative 页 Nano Banana 2 的唯一付费任务契约。
 *
 * 客户端只能提供提示词和画幅；模型、档位、分辨率与价格全部由 Fly worker 锁定，
 * 避免客户端篡改 Pro/4K 参数却仍按 Flash/1K 计费。
 */
export const CREATIVE_NANO_IMAGE_ACTION = "creative_nano_image" as const;
export const CREATIVE_NANO_IMAGE_CREDITS = 35;
export const CREATIVE_NANO_IMAGE_QUALITY = "1k" as const;
export const CREATIVE_NANO_IMAGE_TASK_TYPE = "creativeNanoImage" as const;

export type CreativeNanoImageAspectRatio = "16:9" | "9:16";

export type CreativeNanoImageJobInput = {
  action: typeof CREATIVE_NANO_IMAGE_ACTION;
  params: {
    prompt: string;
    aspectRatio: CreativeNanoImageAspectRatio;
  };
};

export function normalizeCreativeNanoImageAspectRatio(
  raw: unknown,
): CreativeNanoImageAspectRatio {
  return String(raw || "") === "16:9" ? "16:9" : "9:16";
}

export function buildCreativeNanoImageJobInput(input: {
  prompt: string;
  aspectRatio?: unknown;
}): CreativeNanoImageJobInput {
  return {
    action: CREATIVE_NANO_IMAGE_ACTION,
    params: {
      prompt: String(input.prompt || "").trim(),
      aspectRatio: normalizeCreativeNanoImageAspectRatio(input.aspectRatio),
    },
  };
}

export function isCreativeNanoImageJob(input: unknown): input is CreativeNanoImageJobInput {
  return Boolean(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      (input as { action?: unknown }).action === CREATIVE_NANO_IMAGE_ACTION,
  );
}
