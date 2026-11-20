import type {KnowledgeRouteEvidence} from './knowledgePublicationRoutes';

const checkpointRetryDelaysMs = [3000, 5000, 15000, 30000] as const;

export class KnowledgeEditionPersistenceError extends Error {
  constructor(readonly cause: unknown) { super('章节检查点保存或读取失败，保留任务等待恢复'); }
}

function transientStorageFault(error: unknown): boolean {
  return error instanceof TypeError && error.message === 'fetch failed'
    || error instanceof Error && /^gcs_(?:stat|download|upload|list)_failed:(?:408|429|500|502|503|504|network)(?:$|:)/.test(error.message);
}

export function isTransientEditionCheckpointError(error: unknown): boolean {
  return error instanceof KnowledgeEditionPersistenceError &&
    (transientStorageFault(error.cause) || isTransientEditionCheckpointError(error.cause));
}

/** 首次领取记为第1次尝试；第5次仍失败时保留检查点，交由用户决定是否续作。 */
export function editionCheckpointRequeueDelay(attempts: number): number | undefined {
  return checkpointRetryDelaysMs[attempts - 1];
}

async function withCheckpointRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof KnowledgeEditionPersistenceError || (error instanceof Error && error.name === "AbortError")) throw error;
      const delay = checkpointRetryDelaysMs[attempt];
      if (delay === undefined || !transientStorageFault(error)) throw new KnowledgeEditionPersistenceError(error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/** 仅重试同一对象的存取，保持调用方的请求和回执身份。 */
export function guardKnowledgeEditionEvidence(evidence: KnowledgeRouteEvidence): KnowledgeRouteEvidence {
  const listKeys = evidence.listKeys;
  return {...evidence,
    ...(listKeys && {listKeys: async (prefix: string) => {
      // GCS 分页列举已经逐页重试；这里仅标识失败来源。
      try { return await listKeys(prefix); }
      catch (error) {
        if (error instanceof KnowledgeEditionPersistenceError) throw error;
        throw new KnowledgeEditionPersistenceError(error);
      }
    }}),
    read: key => withCheckpointRetry(() => evidence.read(key)),
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
