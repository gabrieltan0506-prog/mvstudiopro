/**
 * 工作流步骤服务端计费执行契约(七审 P0-1)。
 *
 * 背景:chargeStep/refundStep 曾是两只客户端可独立调用的手——用户可以先扣费、
 * 正常拿到成片,再自己调 refundStep 把钱全退回(退款资格无人校验)。
 * 修法:扣费、真实执行、失败退款收进**同一个服务端函数**;前端不再持有任何
 * 可触发退款的能力(refundStep 路由已 FORBIDDEN 下线)。
 *
 * 契约:
 * - executionId 必须是服务端真实 job/operation ID,不信客户端自报;
 *   chargeKey=workflowStep/<userId>/<step>/<executionId> 撞 DB 唯一索引 →
 *   同一执行并发/重试只扣一次(撞键的那腿由 deductCreditsAmount 返回原快照)。
 * - totalCost 必须由服务端价格表计算,客户端只能选产品,不能报金额。
 * - 只有 run() 抛错(真实失败)才退款;退款带 refundKey=refund:<chargeKey>,
 *   同一执行只退一次;个人/团队按原扣款来源同源退回。
 * - action 沿用历史 costKey 命名(workflowSceneImage 等),不改报表聚合维度(七审 P1-6)。
 */
import {
  deductCreditsAmount,
  refundCreditsForDeductAmount,
} from "../credits";

export const WORKFLOW_STEP_ACTION = {
  storyboard: "workflowStoryboard",
  scene_image: "workflowSceneImage",
  render_still: "workflowRenderStill",
  scene_video: "workflowSceneVideo",
  scene_voice: "workflowSceneVoice",
  music: "workflowMusic",
  final_render: "workflowFinalRender",
} as const;

export type WorkflowBillableStep = keyof typeof WORKFLOW_STEP_ACTION;

export function workflowStepChargeKey(input: {
  userId: number;
  step: WorkflowBillableStep;
  executionId: string;
}): string {
  return `workflowStep/${input.userId}/${input.step}/${input.executionId}`.slice(0, 120);
}

export type WorkflowStepBillingDeps = {
  deduct: typeof deductCreditsAmount;
  refund: typeof refundCreditsForDeductAmount;
};

export async function runPaidWorkflowStep<T>(input: {
  userId: number;
  /** 服务端真实 job/operation ID(uuid/jobId),绝不采信客户端自报 */
  executionId: string;
  step: WorkflowBillableStep;
  /** 服务端价格表算出的总额 */
  totalCost: number;
  description: string;
  run: () => Promise<T>;
  /** 测试注入 */
  deps?: WorkflowStepBillingDeps;
}): Promise<T> {
  const userId = Number(input.userId);
  const executionId = String(input.executionId || "").trim();
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("workflow_step_billing_invalid_user");
  }
  if (!executionId) {
    throw new Error("workflow_step_billing_missing_execution_id");
  }
  const deps: WorkflowStepBillingDeps = input.deps || {
    deduct: deductCreditsAmount,
    refund: refundCreditsForDeductAmount,
  };
  const action = WORKFLOW_STEP_ACTION[input.step];
  const chargeKey = workflowStepChargeKey({ userId, step: input.step, executionId });

  const deducted = await deps.deduct(userId, input.totalCost, action, input.description, {
    chargeKey,
  });

  try {
    return await input.run();
  } catch (error) {
    // 只有真实失败到这;refundKey 幂等,重复失败/双路径只退一次
    await deps
      .refund(userId, `${input.description}·执行失败·退回积分`, deducted, `${action}Refund`, {
        refundKey: `refund:${chargeKey}`.slice(0, 120),
      })
      .catch((refundError) => {
        console.error("[workflowStepBilling] refund failed (hold pending):", refundError);
      });
    throw error;
  }
}
