import { knowledgeCardInputFingerprint } from "@shared/knowledgeCardSourceIdentity";
import { pollJobUntilTerminal } from "./jobs";
import type { streamManhuaAdvisor } from "./manhuaAdvisorStream";

type Result = Awaited<ReturnType<typeof streamManhuaAdvisor>>;
/** 未知回执只能读取原请求；明确业务失败不自动重试模型。 */
export async function withKnowledgeAdvisorRecovery(
  requestId: string | undefined,
  execute: () => Promise<Result>,
  owner: () => Promise<{id: number} | null>,
  stillHere: () => boolean,
): Promise<Result> {
  try { return await execute(); }
  catch (error) {
    if (!requestId || (error as {advisorRejected?: boolean})?.advisorRejected) throw error;
    if (!stillHere()) throw Error("已离开原稿，结果保留在原任务");
    const user = await owner();
    if (!user) throw Error("请先登录，再恢复原任务");
    const hash = await knowledgeCardInputFingerprint(`${user.id}:${requestId}`);
    const assertCurrent = () => { if (!stillHere()) throw Error("已离开原稿，结果保留在原任务"); };
    const job = await pollJobUntilTerminal(`manhua_advisor_${hash.slice(0,40)}`, {
      maxWaitMs: 30 * 60_000,
      onUnavailable: assertCurrent,
      onPoll: assertCurrent,
    });
    assertCurrent();
    if (job.status === "failed") throw Error(job.error || "原顾问任务已失败，未重新提交");
    const result = (job.output as {result?: Result} | undefined)?.result;
    if (!result?.success || typeof result.answer !== "string" || !result.answer.trim() || typeof result.remainingFreeToday !== "number") throw Error("原顾问回执不完整，未采用结果");
    return {...result, replayed: true};
  }
}
