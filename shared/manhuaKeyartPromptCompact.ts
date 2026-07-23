/**
 * 关键静帧出图硬上限校验（不截断、不做二次 LLM 精简）。
 * 长度控制靠源头短包（manhuaKeyartSlimPrompt）；此处仅拦截理论上的超限。
 */

/** 上游 images/edits·generations 硬上限 */
export const OPENAI_IMAGE_PROMPT_HARD_MAX = 32_000;

/** 仍超硬上限：报错停住，禁止静默裁字、禁止再打一轮文案 API */
export function assertOpenAiImagePromptWithinLimit(prompt: string): void {
  const n = String(prompt || "").trim().length;
  if (n > OPENAI_IMAGE_PROMPT_HARD_MAX) {
    throw new Error(
      `关键静帧说明过长（约 ${n} 字，上限 ${OPENAI_IMAGE_PROMPT_HARD_MAX}）。请缩短本镜分镜描述后重试；系统不会截断，也不会再额外调用文案优化。`,
    );
  }
}
