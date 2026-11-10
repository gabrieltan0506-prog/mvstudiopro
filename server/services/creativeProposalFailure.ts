import { describeValidationErrorZh } from "../../shared/creativeProposalRepair";

/**
 * MV/歌曲/学习顾问的方案校验失败：带具体中文原因，一路透传到用户可见的 ADVISOR_OPERATION_FAILED 文案，
 * 不再被泛化成「本次问答未完成」。只含阶段与校验原因，不含提示词、素材或模型正文。
 * `compose` / `refine`：三跳 fallback（GLM@EvoLink → GLM@OpenRouter → DeepSeek）全部用尽，reasonZh 含每跳原因。
 */
export type CreativeProposalStage = "glm-draft" | "repair-1-glm-draft" | "astra" | "repair-1-astra" | "compose" | "refine" | "beats" | "fill";

export class CreativeProposalError extends Error {
  constructor(
    readonly stage: CreativeProposalStage,
    readonly reasonZh: string,
    readonly attempts: number,
    /** 三跳链每跳的失败原因（含重写），按顺序。 */
    readonly hopFailuresZh: readonly string[] = [],
  ) {
    super(
      stage === "compose"
        ? `创作方案三条通道均未通过校验：${reasonZh}`
        : stage === "refine"
          ? `联合创作三条通道均未通过校验：${reasonZh}`
          : stage === "beats"
            ? `逐窗节拍三条通道均未通过校验：${reasonZh}`
            : stage === "fill"
              ? `素材填充建议三条通道均未通过校验：${reasonZh}`
          : `${stage.startsWith("repair") ? "修复重试后方案仍未通过校验" : stage === "astra" ? "联合创作结果未通过校验" : "创作方案未通过校验"}：${reasonZh}`,
    );
    this.name = "CreativeProposalError";
  }
}

export function toCreativeProposalError(error: unknown, stage: CreativeProposalStage, attempts: number): CreativeProposalError {
  if (error instanceof CreativeProposalError) return error;
  return new CreativeProposalError(stage, describeValidationErrorZh(error), attempts);
}

export function creativeProposalFailureMessage(error: unknown): string | undefined {
  return error instanceof CreativeProposalError ? error.message : undefined;
}
