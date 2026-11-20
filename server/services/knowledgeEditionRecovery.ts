import type {KnowledgeRouteEvidence} from './knowledgePublicationRoutes';

/** runner「按尝试次数重排」专用：长度即重排次数，不能改（见 editionCheckpointRequeueDelay）。 */
const checkpointRetryDelaysMs = [3000, 5000, 15000, 30000] as const;
/**
 * 原地重试窗口（1120）：原 3/5/15/30 秒共约 53 秒，对象存储一次几分钟的抖动就让整单失败（当日两次）。
 * 拉长到约 5.9 分钟并加 ±20% 抖动，避免几十个批次同一刻一起重打。与重排数组分开，重排次数语义不变。
 */
const inPlaceRetryDelaysMs = [3000, 5000, 15000, 30000, 60000, 120000, 120000] as const;
/** 对象存在但 JSON 截断/解析失败：最多重读 2 次，仍坏按原样失败，不吞真损坏。 */
const MAX_JSON_REREADS = 2;

export class KnowledgeEditionPersistenceError extends Error {
  constructor(readonly cause: unknown) { super('章节检查点保存或读取失败，保留任务等待恢复'); }
}

const TRANSIENT_NETWORK_CODES = /^(?:ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ECONNABORTED|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED)$/;

function transientStorageFault(error: unknown, depth = 0): boolean {
  if (!error || depth > 3) return false;
  const e = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (error instanceof TypeError && (message === 'fetch failed' || message === 'terminated')) return true;
  if (error instanceof Error && /^gcs_(?:stat|download|upload|list)_failed:(?:408|429|500|502|503|504|network)(?:$|:)/.test(message)) return true;
  // 换令牌接口的网络错误与 408/429/5xx（vertex.ts 已短退避重试过，仍失败才到这里）。
  if (error instanceof Error && /^vertex_token_failed:(?:408|429|5\d\d|network)(?:$|:)/.test(message)) return true;
  // 大对象读正文中断、连接被重置、套接字挂断、超时。
  if (e.name === 'TimeoutError') return true;
  if (typeof e.code === 'string' && TRANSIENT_NETWORK_CODES.test(e.code)) return true;
  if (/^(?:socket hang up|read ECONNRESET|other side closed)$/i.test(message)) return true;
  return transientStorageFault(e.cause, depth + 1);
}

export function isTransientEditionCheckpointError(error: unknown): boolean {
  return error instanceof KnowledgeEditionPersistenceError &&
    (transientStorageFault(error.cause) || isTransientEditionCheckpointError(error.cause));
}

/** 首次领取记为第1次尝试；第5次仍失败时保留检查点，交由用户决定是否续作。 */
export function editionCheckpointRequeueDelay(attempts: number): number | undefined {
  return checkpointRetryDelaysMs[attempts - 1];
}

const jittered = (delay: number) => Math.round(delay * (0.8 + 0.4 * Math.random()));

async function withCheckpointRetry<T>(operation: () => Promise<T>, options: { rereadJson?: boolean } = {}): Promise<T> {
  let jsonRereads = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof KnowledgeEditionPersistenceError || (error instanceof Error && error.name === "AbortError")) throw error;
      const delay = inPlaceRetryDelaysMs[attempt];
      // 读取时 JSON 被截断（读正文中途断开）可重读恢复；仅限读，且最多两次。
      const truncatedJson = options.rereadJson === true && error instanceof SyntaxError && jsonRereads < MAX_JSON_REREADS;
      if (delay === undefined || !(transientStorageFault(error) || truncatedJson)) throw new KnowledgeEditionPersistenceError(error);
      if (truncatedJson) jsonRereads += 1;
      await new Promise(resolve => setTimeout(resolve, jittered(delay)));
    }
  }
}

/** 仅重试同一对象的存取，保持调用方的请求和回执身份。 */
export function guardKnowledgeEditionEvidence(evidence: KnowledgeRouteEvidence): KnowledgeRouteEvidence {
  const listKeys = evidence.listKeys;
  return {...evidence,
    // GCS 分页列举只在页内重试约 3 秒；外层再套同样的原地重试窗口，整次列举从头重来（只读、无副作用）。
    ...(listKeys && {listKeys: (prefix: string) => withCheckpointRetry(() => listKeys(prefix))}),
    read: key => withCheckpointRetry(() => evidence.read(key), {rereadJson: true}),
    save: (key, value) => withCheckpointRetry(() => evidence.save(key, value)),
  };
}
export function rethrowKnowledgeEditionInvariant(error: unknown) {
  if (error instanceof KnowledgeEditionPersistenceError || (error as Error)?.name === 'AbortError' || /版本变化|原稿变化|输入变化|身份不一致|不属于本人/.test(String((error as Error)?.message))) throw error;
}
export function knowledgeEditionErrorMessage(error: unknown) {
  return String((error as Error)?.message || error).replace(/(?:https?|gs):\/\/[^\s"']+/g,'[地址]').slice(0,1000);
}
export function isKnowledgeReceiptUnknown(error: unknown) {
  return /尚未闭合|未知回执|pending|unknown/i.test(knowledgeEditionErrorMessage(error));
}

/** 临时性存储/网络抖动（含包装后的检查点错误）：可原地重做同一步，不计入任何重试额度。 */
export function isTransientKnowledgeStorageFault(error: unknown): boolean {
  return transientStorageFault(error) || isTransientEditionCheckpointError(error);
}
/** 分段提炼原地重做同一步的等待（与检查点原地重试同一窗口，约 5.9 分钟，加抖动）。 */
export function knowledgeInPlaceRetryDelaysMs(): readonly number[] {
  return inPlaceRetryDelaysMs.map(jittered);
}

/**
 * 分段提炼单批失败分类（1121 大书卡死）：
 * - definite：三跳回落已明确失败（回执闭合、额度用尽/写坏/两次断流判失败/内容审核拒绝），可在新证据目录再试或减半；
 * - transient：临时性存储/网络错误，原地重做同一步，不计次数；
 * - hold：结果未知（未闭合回执）、取消、身份/版本不变量、无法识别的错误——一律原样上抛，不换目录、不重买。
 */
export type KnowledgeDistillFailureCategory = 'routes_exhausted' | 'invalid_output' | 'stream_interrupted' | 'content_safety';
export function classifyKnowledgeDistillFailure(error: unknown):
  | { kind: 'definite'; category: KnowledgeDistillFailureCategory }
  | { kind: 'transient' }
  | { kind: 'hold' } {
  const e = error as { name?: unknown; code?: unknown; knowledgeDistillDefinite?: unknown } | null;
  if (!error || e?.name === 'AbortError') return { kind: 'hold' };
  if (isTransientKnowledgeStorageFault(error)) return { kind: 'transient' };
  if (error instanceof KnowledgeEditionPersistenceError) return { kind: 'hold' };
  // 回包内容已保存且确定不合格（由提炼层标注）：即使校验报「身份不一致」也是模型写坏，不是我方身份变化。
  if (typeof e?.knowledgeDistillDefinite === 'string') return { kind: 'definite', category: e.knowledgeDistillDefinite as KnowledgeDistillFailureCategory };
  const message = knowledgeEditionErrorMessage(error);
  if (/版本变化|原稿变化|输入变化|身份不一致|身份变化|身份不符|不属于本人/.test(message)) return { kind: 'hold' };
  if (e?.name === 'SseContentSafetyError' || e?.code === 'sse_content_safety') return { kind: 'definite', category: 'content_safety' };
  if (/^图文整理的所有已配置通道均失败/.test(message)) return { kind: 'definite', category: 'routes_exhausted' };
  if (/^传输中断已发生.*本章判失败/.test(message)) return { kind: 'definite', category: 'stream_interrupted' };
  if (e?.name === 'KnowledgeJsonSyntaxError') return { kind: 'definite', category: 'invalid_output' };
  return { kind: 'hold' };
}
