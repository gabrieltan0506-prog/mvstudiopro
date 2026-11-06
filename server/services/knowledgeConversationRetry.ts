import { createHash } from 'node:crypto';
import type { EditableLayout } from '../../shared/editableLayout';
import { canonicalRefundKey } from './paidJobLedger';
import { getJobByIdStrict } from '../jobs/repository';
import { readChargeRefundState } from '../credits';
import { downloadGcsObjectVersioned, getGcsBucketName } from './gcs';
import { manhuaAdvisorOperationId, MANHUA_ADVISOR_FAILED_ACTION, MANHUA_ADVISOR_REFUND_RECONCILED_ACTION } from './manhuaAdvisorOperation';
import { KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES } from './knowledgeModelCapabilities';

const real = {
  job: getJobByIdStrict,
  billing: readChargeRefundState,
  read: async (name: string): Promise<any> => {
    try { return JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${name}`})).buffer.toString('utf8')); }
    catch (e) { if(e instanceof Error && e.message==='gcs_stat_failed:404') return null; throw e; }
  },
};
/** 同一失败只派生一个后继编号；多标签或保存响应丢失不能造成多次购买。 */
export function knowledgeConversationRetryId(owner: number, documentId: string, failedId: string) {
  const h=createHash('sha256').update(`conversation-retry:${owner}:${documentId}:${failedId}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function checkKnowledgeConversationRetry(owner: number, doc: EditableLayout, failedId: string, overrides: Partial<typeof real>={}) {
  const deps={...real,...overrides}, pub=doc.publication, turn=pub?.conversation?.at(-1),req=turn?.request;
  if(!req||req.id!==failedId||req.manuscript!==pub?.manuscript||turn?.response)
    throw Error('稿件或对话已变化，请读取原请求结果后再操作');
  const jobId=manhuaAdvisorOperationId(owner,failedId),job=await deps.job(jobId);
  const output=job?.output as Record<string,unknown>|null;
  const input=job?.input as Record<string,unknown>|null;
  if(!job||String(job.userId)!==String(owner)||input?.requestId!==failedId||job.status!=='failed')
    throw Error('原请求尚未确认失败，请继续恢复原请求，不要重复提交');
  if(![MANHUA_ADVISOR_FAILED_ACTION,MANHUA_ADVISOR_REFUND_RECONCILED_ACTION].includes(String(output?.action)))
    throw Error('原请求积分仍在对账，请稍后核对，未创建新请求');
  const billing=await deps.billing(owner,`manhuaAdvisor/${jobId}`,canonicalRefundKey("manhuaAdvisor",jobId));
  if(!billing.settled || (billing.charged>0 && (output?.action!==MANHUA_ADVISOR_REFUND_RECONCILED_ACTION || !(Number(output?.creditsRefunded)>=billing.charged))))
    throw Error('原请求退款尚未确认完成，未创建新请求');
  const prefix=`knowledge-publications/user-${owner}/${doc.id}/conversation/${failedId}`;
  for(const name of ['report.json','accepted.json','raw.json'])
    if(await deps.read(`${prefix}/${name}`))throw Error('原请求已有结果，请恢复原结果，不能再次付费交流');
  for(const name of KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES.flatMap(route=>[`route-${route}.json`,`research/route-${route}.json`])) {
    const receipt=await deps.read(`${prefix}/${name}`);
    if(!receipt)continue;
    if(receipt.state==='unavailable')continue;
    if(name.startsWith('research/') && receipt.state==='received' && Number.isInteger(receipt.response?.status)&&typeof receipt.response?.text==='string')continue;
    if(receipt.state==='failed' && (receipt.sent===false || (Number.isInteger(receipt.response?.status)&&typeof receipt.response?.text==='string')))continue;
    throw Error('上游请求状态尚未闭合，请恢复原请求，未创建新请求');
  }
  return {requestId:knowledgeConversationRetryId(owner,doc.id,failedId)};
}
