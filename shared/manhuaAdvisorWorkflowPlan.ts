import { z } from "zod";
import { creativeVoiceProductionSchema } from "./creativeVoiceProduction";
import { MANHUA_ADVISOR_WORKFLOW_HELP } from "./manhuaAdvisorWorkflow";

export const advisorWorkflowPlanSchema = z
  .object({
    kind: z.literal("workflow_operation_v1"),
    summaryZh: z.string().trim().min(1).max(1200),
    action: creativeVoiceProductionSchema,
  })
  .strict();
export type AdvisorWorkflowPlan = z.infer<typeof advisorWorkflowPlanSchema>;

export function parseAdvisorWorkflowPlan(answer: string): AdvisorWorkflowPlan {
  const source = answer
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return advisorWorkflowPlanSchema.parse(JSON.parse(source));
}

/** 一个方案只执行一步，后续步骤必须依据最新回执重新准备。 */
export function buildAdvisorWorkflowQuestion(
  question: string,
  workspace: string
): string {
  return `按用户本次明确要求准备一个实际工作流操作，先核对以下当前作品清单。只返回JSON：{"kind":"workflow_operation_v1","summaryZh":"中文说明目标、改动与确认边界","action":{"action":"工具动作",其余为该动作参数}}。只允许一个动作，不自动串行生成，不声称方案已执行。无法确定目标时返回普通中文解释，请用户补充，不猜ID。\n${MANHUA_ADVISOR_WORKFLOW_HELP}\n已有动作仍可用：prepareEpisode/applyEpisode/prepareStoryboard/applyStoryboard(episode，prepare需question)、assets、image2d(anchorId)、model3d(assetId)、previs(clipId)、renderPrevis(question)、applyPrevis、world(assetId/question)、generateWorld、retryWorld(assetId)、retryPrevis、media(operation)、bgm(clipId/operation/question)、restoreBackup。素材修改方案须先沿proposeMediaEdit原入口准备；不要编造素材方案。\n<当前工作区清单>\n${workspace}\n</当前工作区清单>\n用户原话：${question}`;
}

/** 工作区版本摘要；不将素材URL、对白全文再次保存到操作记录。 */
export function advisorWorkflowRevision(value: unknown): string {
  const source = JSON.stringify(value) ?? "undefined";
  let first = 0x811c9dc5,
    second = 0x9747b28c;
  for (let index = 0; index < source.length; index++) {
    first = Math.imul(first ^ source.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ source.charCodeAt(index), 0x5bd1e995);
  }
  return `${source.length}:${first >>> 0}:${second >>> 0}`;
}

/** 后续操作只依据编号和回执；素材地址留在原工作流，不再次交给文字模型。 */
export function advisorWorkflowReceiptContext(receipt: string): string {
  return receipt.replace(
    /(?:https?|ftp|gs|blob):\/\/[^\s"'<>]+/gi,
    "[素材地址已隐藏]"
  );
}
