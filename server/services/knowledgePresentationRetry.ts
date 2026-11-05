import { createHash } from 'node:crypto';
import type { EditableLayout } from '../../shared/editableLayout';
import { canonicalRefundKey } from './paidJobLedger';
import { getJobByIdStrict } from '../jobs/repository';
import { readChargeRefundState } from '../credits';
import { downloadGcsObjectVersioned, getGcsBucketName } from './gcs';
import { manhuaAdvisorOperationId, MANHUA_ADVISOR_FAILED_ACTION, MANHUA_ADVISOR_REFUND_RECONCILED_ACTION } from './manhuaAdvisorOperation';

const real = {
  job: getJobByIdStrict,
  billing: readChargeRefundState,
  read: async (name: string): Promise<any> => {
    try { return JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${name}`})).buffer.toString('utf8')); }
    catch (e) { if(e instanceof Error && e.message==='gcs_stat_failed:404') return null; throw e; }
  },
};
/** 同一失败只派生一个后继编号；多标签或保存响应丢失不能造成多次购买。 */
export function knowledgePresentationRetryId(owner: number, documentId: string, failedId: string) {
  const h=createHash('sha256').update(`presentation-retry:${owner}:${documentId}:${failedId}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function checkKnowledgePresentationRetry(owner: number, doc: EditableLayout, failedId: string, overrides: Partial<typeof real>={}) {
  const deps={...real,...overrides}, pub=doc.publication, req=pub?.presentationRequest;
  if(!req||req.id!==failedId||req.manuscript!==pub?.manuscript||pub.presentationPlan)
    throw Error('稿件或提纲已变化，请读取原请求结果后再操作');
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
  const prefix=`knowledge-publications/user-${owner}/${doc.id}/${failedId}/presentation`;
  for(const name of ['report.json','accepted.json','raw.json'])
    if(await deps.read(`${prefix}/${name}`))throw Error('原请求已有结果，请恢复原结果，不能再次付费规划');
  for(const route of ['openrouter','evolink','vertex']) {
    const receipt=await deps.read(`${prefix}/route-${route}.json`);
    if(!receipt)continue;
    if(receipt.state==='unavailable')continue;
    if(receipt.state==='failed' && (receipt.sent===false || (Number.isInteger(receipt.response?.status)&&typeof receipt.response?.text==='string')))continue;
    throw Error('上游请求状态尚未闭合，请恢复原请求，未创建新请求');
  }
  return {requestId:knowledgePresentationRetryId(owner,doc.id,failedId)};
}
/** 保存时再次核验，不信任前端检查结果；对象版本CAS继续负责并发写入。 */
export async function validateKnowledgePresentationRetryTransition(owner:number, before:EditableLayout, after:EditableLayout, check=checkKnowledgePresentationRetry) {
  const old=before.publication?.presentationRequest,next=after.publication?.presentationRequest;
  if(!old||!next||old.id===next.id||old.manuscript!==next.manuscript||old.minSlides!==next.minSlides||old.maxSlides!==next.maxSlides)return;
  const expected=await check(owner,before,old.id);
  if(next.id!==expected.requestId)throw Error('请先核对失败与退款状态，再确认重试；未保存新请求');
}
