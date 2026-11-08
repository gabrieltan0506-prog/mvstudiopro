import { KNOWLEDGE_CARD_REQUEST_ID, type KnowledgeCardPageAction } from "@shared/knowledgeCardPageTask";
import { knowledgeCardInputFingerprint } from "@shared/knowledgeCardSourceIdentity";

/** 与服务端 createKnowledgeCardPageJob 同一身份，提交回包丢失也只查询这一个任务。 */
export async function knowledgeCardTrackedJobId(owner: string | null, action: KnowledgeCardPageAction, requestId: string) {
  if (!owner || !KNOWLEDGE_CARD_REQUEST_ID.test(requestId)) throw Error("无法确认本次任务身份，请先登录");
  return `kc_${(await knowledgeCardInputFingerprint(JSON.stringify([owner, action, requestId.toLowerCase()]))).slice(0, 56)}`;
}

/** 只有明确的业务拒绝才结束提交；传输错误与服务端未知错误不代表没有入队。 */
export async function submitKnowledgeCardOnce<T>(submit: () => Promise<T>, onLateRejected?: (error: unknown) => void): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingForReceipt = true;
  try {
    // 只限制等待提交回执的时间；请求可能已被服务器接受，不中断或重发POST。
    const submitted = submit().catch(error => {
      const code = (error as { data?: { code?: string } })?.data?.code;
      if (code && ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "CONFLICT", "PAYMENT_REQUIRED", "TOO_MANY_REQUESTS"].includes(code)) {
        if (!waitingForReceipt) onLateRejected?.(error);
        throw error;
      }
      return undefined;
    });
    return await Promise.race([submitted, new Promise<undefined>(resolve => { timer=setTimeout(()=>{waitingForReceipt=false;resolve(undefined);},30_000); })]);
  }
  catch (error) {
    const code = (error as { data?: { code?: string } })?.data?.code;
    if (code && ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "CONFLICT", "PAYMENT_REQUIRED", "TOO_MANY_REQUESTS"].includes(code)) throw error;
    return undefined;
  } finally { if(timer)clearTimeout(timer); }
}

/** 未查到任务与登录失败不是已确认的网络故障；提示不能假称后台正在恢复。 */
export function knowledgeCardRecoveryMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Job not found|\(404\)/i.test(message)) return "尚未查到本次任务，提交是否成功仍未确认；保留原请求，请勿重复提交";
  if (/\(40[13]\)|登录状态|Unauthorized|Forbidden/i.test(message)) return "登录验证未通过，暂时无法查询原任务；原稿保留，不会重新提交";
  return "连接暂时中断，正在查询原任务；请勿重复提交";
}
