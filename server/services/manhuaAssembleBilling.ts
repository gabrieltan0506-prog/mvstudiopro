import { deductCreditsAmount, refundCreditsForDeductAmount } from "../credits.js";
import { CREDIT_COSTS } from "../plans.js";
import { workflowStepChargeKey, WORKFLOW_STEP_ACTION } from "./workflowStepBilling.js";
import {
  readActiveJob, registerActiveJob, refundCreditsOnFailure,
} from "./paidJobLedger.js";

export const MANHUA_ASSEMBLE_LEDGER_TYPE = "manhuaFinalAssemble";

export type ManhuaAssembleBillingDeps = {
  deduct: typeof deductCreditsAmount;
  refundDirect: typeof refundCreditsForDeductAmount;
  readHold: typeof readActiveJob;
  register: typeof registerActiveJob;
  refund: typeof refundCreditsOnFailure;
};

/** 价格沿用最终合成现价；只在真实任务内扣款，配乐创作仍走独立确认流程。 */
export async function runPaidManhuaAssemble<T>(input: {
  userId: number;
  jobId: string;
  run: () => Promise<T>;
  deps?: ManhuaAssembleBillingDeps;
}): Promise<T> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0 || !input.jobId) {
    throw new Error("合成缺少有效任务身份，未扣积分");
  }
  const deps = input.deps ?? {
    deduct: deductCreditsAmount, refundDirect: refundCreditsForDeductAmount,
    readHold: readActiveJob, register: registerActiveJob, refund: refundCreditsOnFailure,
  };
  // 重启／人工重排同一任务不可复用已退积分的扣款快照继续渲染。
  if (await deps.readHold(input.jobId, MANHUA_ASSEMBLE_LEDGER_TYPE)) {
    throw new Error("此合成任务已有执行记录，请先核对原任务，未重复执行");
  }
  const chargeKey = workflowStepChargeKey({ userId: input.userId, step: "final_render", executionId: input.jobId });
  const deducted = await deps.deduct(
    input.userId, CREDIT_COSTS.workflowFinalRender, WORKFLOW_STEP_ACTION.final_render,
    "漫剧成片坞·最终合成", { chargeKey },
  );
  try {
    await deps.register({
      jobId: input.jobId, taskType: MANHUA_ASSEMBLE_LEDGER_TYPE, userId: input.userId,
      creditsBilled: deducted.cost, action: "漫剧成片坞·最终合成", deduct: deducted,
      metadata: { chargeKey },
    });
  } catch (error) {
    await deps.refundDirect(input.userId, "合成账本登记失败·退回积分", deducted,
      `${WORKFLOW_STEP_ACTION.final_render}Refund`, { refundKey: `refund:${chargeKey}` });
    throw error;
  }
  try {
    // 不在这里结算；worker 必须先把成片写入 jobs，才可以标记 settled。
    return await input.run();
  } catch (error) {
    await deps.refund(input.jobId, MANHUA_ASSEMBLE_LEDGER_TYPE, "task_failed", "合成失败·退回积分");
    throw error;
  }
}
