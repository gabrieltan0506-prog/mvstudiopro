import { KNOWLEDGE_CARD_REQUEST_ID, type KnowledgeCardPageAction } from "@shared/knowledgeCardPageTask";
import { knowledgeCardInputFingerprint } from "@shared/knowledgeCardSourceIdentity";

/** 与服务端 createKnowledgeCardPageJob 同一身份，提交回包丢失也只查询这一个任务。 */
export async function knowledgeCardTrackedJobId(owner: string | null, action: KnowledgeCardPageAction, requestId: string) {
  if (!owner || !KNOWLEDGE_CARD_REQUEST_ID.test(requestId)) throw Error("无法确认本次任务身份，请先登录");
  return `kc_${(await knowledgeCardInputFingerprint(JSON.stringify([owner, action, requestId.toLowerCase()]))).slice(0, 56)}`;
}

/** 只有明确的业务拒绝才结束提交；传输错误与服务端未知错误不代表没有入队。 */
export async function submitKnowledgeCardOnce<T>(submit: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 只限制等待提交回执的时间；请求可能已被服务器接受，不中断或重发POST。
    return await Promise.race([submit(), new Promise<undefined>(resolve => { timer=setTimeout(()=>resolve(undefined),30_000); })]);
  }
  catch (error) {
    const code = (error as { data?: { code?: string } })?.data?.code;
    if (code && ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "CONFLICT", "PAYMENT_REQUIRED", "TOO_MANY_REQUESTS"].includes(code)) throw error;
    return undefined;
  } finally { if(timer)clearTimeout(timer); }
}
