import { z } from "zod";
export const codeMotionSemanticFindingSchema = z
  .object({
    index: z.number().int().min(0).max(5),
    imageIds: z.array(z.string().uuid()).min(1).max(8),
    status: z.enum(["aligned", "conflict", "uncertain"]),
    confidence: z.number().min(0).max(1),
    requirement: z.string().min(1).max(2000),
    repair: z.string().max(2000),
    observations: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(100),
            observation: z.string().min(4).max(1500),
            atSec: z.number().min(0).optional(),
          })
          .strict()
      )
      .min(1)
      .max(30),
  })
  .strict();
export const codeMotionSemanticReportSchema = z
  .object({
    findings: z.array(codeMotionSemanticFindingSchema).max(6),
    coverage: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(100),
            readable: z.boolean(),
            observation: z.string().min(4).max(1500),
          })
          .strict()
      )
      .min(1)
      .max(40),
    limitations: z.string().max(3000),
  })
  .strict();
export type CodeMotionSemanticReport = z.infer<
  typeof codeMotionSemanticReportSchema
>;
export type CodeMotionSemanticFinding = z.infer<
  typeof codeMotionSemanticFindingSchema
>;
export function semanticImageDecision(
  finding: CodeMotionSemanticFinding | undefined
) {
  if (!finding)
    return {
      assessment: "not_performed" as const,
      reasons: [] as string[],
      repair: "",
    };
  const conflict =
    finding.status === "conflict" &&
    finding.confidence >= 0.8 &&
    !!finding.repair.trim();
  return {
    assessment: conflict
      ? ("conflict" as const)
      : finding.status === "aligned" && finding.confidence >= 0.8
        ? ("aligned" as const)
        : ("uncertain" as const),
    reasons: conflict
      ? [
          `语义冲突（可信度 ${Math.round(finding.confidence * 100)}%）：${finding.observations.map(o => o.observation).join("；")}；目标要求：${finding.requirement}`,
        ]
      : [],
    repair: conflict ? finding.repair : "",
  };
}
