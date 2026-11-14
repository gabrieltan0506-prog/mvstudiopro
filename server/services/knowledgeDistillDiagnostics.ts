/**
 * 读档提炼失败诊断（站长 2026-11-14：「失败原因要能直接看到，不用人盯后台」）。
 * 从本批证据目录的路由回执汇总：失败类别、经过的跳（通道代号与结果）、各跳耗时、最后一次心跳距失败多久。
 * 只给管理员 Debug 面板显示；不含正文、地址、密钥，模型/通道代号只出现在这里。
 */
import { KNOWLEDGE_PUBLICATION_ALL_ROUTES } from './knowledgeModelCapabilities';
import type { KnowledgeRouteEvidence } from './knowledgePublicationRoutes';

export type KnowledgeDistillHopDiagnostic = {
  route: string; channel: string; family: 'glm' | 'deepseek'; state: string; httpStatus?: number;
  /** 传输中断原因：no_heartbeat（无字节）/ no_heartbeat_headers（等响应头）/ keepalive_only（仅保活）/ transport */
  transportCause?: string;
  /** 回执记下的拒收原因骨架（截断，不含正文/地址） */
  reason?: string; durationMs?: number;
};
export type KnowledgeDistillSegmentDiagnostic = {
  segment: number; total: number; label: string; category: string; categoryZh: string;
  hops: KnowledgeDistillHopDiagnostic[];
  /** 最后收到任何字节（含推理增量与保活注释）距失败多久 */
  lastHeartbeatAgoMs?: number;
  /** 最后收到正文增量距失败多久（与上一项对比即可看出「仅保活/仅推理」） */
  lastContentAgoMs?: number;
  failedAt: string;
};
const CATEGORY_ZH: Record<string, string> = {
  no_heartbeat: '无心跳/断流中断', keepalive_only: '仅保活超时（长时间只有空讯息）', rate_limited: '限流重试用尽', rejected: '4xx 拒绝（鉴权/参数）', insufficient_credit: '该通道额度不足（HTTP 402）', output_limit: '撞单次输出上限',
  incomplete: '输出未完整结束', bad_output: '内容校验不过', unresolved_receipt: '回执未闭合（等待迟到回执）', other: '其他',
};
const safe = (text: unknown) => String(text ?? '').replace(/(?:https?|gs):\/\/\S+/gi, '[地址]').replace(/[A-Za-z0-9_-]{32,}/g, '[略]').replace(/\s+/g, ' ').slice(0, 120);
const ms = (from?: string, to?: string) => { const a = Date.parse(from || ''), b = Date.parse(to || ''); return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : undefined; };

export function classifyKnowledgeDistillFailure(error: unknown, hops: KnowledgeDistillHopDiagnostic[]): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/回执尚未闭合|回执未闭合|等待迟到回执/.test(message) || hops.some(h => h.state === 'unknown' || h.state === 'pending')) return 'unresolved_receipt';
  if (hops.some(h => h.transportCause === 'keepalive_only')) return 'keepalive_only';
  if (/传输中断已发生/.test(message)) return 'no_heartbeat';
  const last = [...hops].reverse().find(h => h.state === 'failed');
  if (!last) return hops.some(h => h.state === 'interrupted') ? 'no_heartbeat' : 'other';
  if (/单次输出容量/.test(last.reason || '')) return 'output_limit';
  if (/未完整结束/.test(last.reason || '')) return 'incomplete';
  const status = last.httpStatus ?? 0;
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'insufficient_credit';
  if (status >= 400 && status < 500) return 'rejected';
  if (status >= 500) return 'rate_limited';
  return 'bad_output';
}

/** 汇总某批证据目录；读失败不影响原错误上抛。 */
export async function collectKnowledgeDistillDiagnostic(evidence: KnowledgeRouteEvidence, prefix: string, error: unknown,
  meta: { segment: number; total: number; label: string }, now = new Date()): Promise<KnowledgeDistillSegmentDiagnostic> {
  const hops: KnowledgeDistillHopDiagnostic[] = [];
  const started = new Map<string, number>();
  let lastBeat = 0, lastContent = 0;
  for (const target of KNOWLEDGE_PUBLICATION_ALL_ROUTES) {
    let receipt: any = null, beat: any = null;
    try { receipt = await evidence.read(`${prefix}/route-${target.id}.json`); beat = await evidence.read(`${prefix}/${target.id}-heartbeat.json`); } catch { /* 诊断尽力而为 */ }
    const at = Date.parse(beat?.at || ''); if (Number.isFinite(at)) lastBeat = Math.max(lastBeat, at);
    const contentAt = Date.parse(beat?.lastContentAt || ''); if (Number.isFinite(contentAt)) lastContent = Math.max(lastContent, contentAt);
    if (!receipt) continue;
    const startedAt = Date.parse(receipt.purchaseStartedAt || receipt.startedAt || ''); if (Number.isFinite(startedAt)) started.set(target.id, startedAt);
    const ended = receipt.endedAt || receipt.interruptedAt || receipt.at;
    hops.push({ route: target.id, channel: target.channel, family: target.model.includes('deepseek') ? 'deepseek' : 'glm', state: String(receipt.state || ''),
      ...(typeof receipt.transportCause === 'string' ? { transportCause: receipt.transportCause } : {}),
      ...(typeof receipt.response?.status === 'number' ? { httpStatus: receipt.response.status } : typeof receipt.status === 'number' ? { httpStatus: receipt.status } : {}),
      ...(receipt.response?.status === 402 ? { reason: '该通道额度不足' } : receipt.reason ? { reason: safe(receipt.reason) } : {}),
      ...(ms(receipt.purchaseStartedAt || receipt.startedAt, ended) !== undefined ? { durationMs: ms(receipt.purchaseStartedAt || receipt.startedAt, ended) } : {}) });
  }
  // 按实际发出先后排列（回执里的 startedAt；没有的排最后）。
  hops.sort((a, b) => (started.get(a.route) ?? Number.MAX_SAFE_INTEGER) - (started.get(b.route) ?? Number.MAX_SAFE_INTEGER));
  const category = classifyKnowledgeDistillFailure(error, hops);
  return { segment: meta.segment, total: meta.total, label: safe(meta.label), category, categoryZh: CATEGORY_ZH[category] || category, hops,
    ...(lastBeat ? { lastHeartbeatAgoMs: Math.max(0, now.getTime() - lastBeat) } : {}),
    ...(lastContent ? { lastContentAgoMs: Math.max(0, now.getTime() - lastContent) } : {}), failedAt: now.toISOString() };
}

/** 沿 cause 链取出诊断（prepare 层会把原错误包进中性文案的 cause）。 */
export function knowledgeDistillDiagnosticsOf(error: unknown): KnowledgeDistillSegmentDiagnostic[] | undefined {
  for (let current: any = error, depth = 0; current && depth < 6; current = current.cause, depth++) {
    if (Array.isArray(current.knowledgeDistillDiagnostics)) return current.knowledgeDistillDiagnostics;
  }
  return undefined;
}
