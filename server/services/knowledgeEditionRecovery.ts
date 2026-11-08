import type {KnowledgeRouteEvidence} from './knowledgePublicationRoutes';

class KnowledgeEditionPersistenceError extends Error {
  constructor(readonly cause: unknown) { super('章节检查点保存或读取失败，保留任务等待恢复'); }
}

/** 存储/身份/取消不能被当成可联网修补的正文错误。 */
export function guardKnowledgeEditionEvidence(evidence: KnowledgeRouteEvidence): KnowledgeRouteEvidence {
  return {...evidence,
    read: async key => {try{return await evidence.read(key);}catch(error){throw new KnowledgeEditionPersistenceError(error);}},
    save: async (key,value) => {try{await evidence.save(key,value);}catch(error){throw new KnowledgeEditionPersistenceError(error);}},
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
