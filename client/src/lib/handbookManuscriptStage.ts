import { KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS } from "@shared/knowledgeCardPagination";

/**
 * 1119 C4：超过 20 万字的手册原稿先分段暂存（每段恰好 20 万字，末段为余数），报价与出图只带摘要。
 * 20 万字及以下的原稿完全不走这里（请求形状与旧版逐字节一致）。
 * 上传幂等：同一原稿重复上传不会覆盖；中途断开后再次调用会补齐缺段再封存，未封存的原稿服务端不报价也不出图。
 */
export type HandbookManuscriptStageApi = {
  stageChunk: (input: { digest: string; index: number; count: number; totalChars: number; text: string }) => Promise<unknown>;
  finalize: (input: { digest: string; count: number; totalChars: number }) => Promise<unknown>;
};

export const handbookManuscriptNeedsStaging = (text: string) => text.length > KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS;

export async function handbookManuscriptDigest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** 本页会话内已封存的原稿摘要（只省去重复上传；服务端仍逐次核验） */
const finalized = new Set<string>();
const inflight = new Map<string, Promise<string>>();

export async function stageHandbookManuscript(text: string, api: HandbookManuscriptStageApi): Promise<string> {
  const digest = await handbookManuscriptDigest(text);
  if (finalized.has(digest)) return digest;
  const running = inflight.get(digest);
  if (running) return running;
  const work = (async () => {
    const size = KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS, count = Math.ceil(text.length / size);
    // 顺序上传：任一段失败即整体失败（不封存），再次调用从头幂等补齐
    for (let index = 0; index < count; index++) {
      await api.stageChunk({ digest, index, count, totalChars: text.length, text: text.slice(index * size, (index + 1) * size) });
    }
    await api.finalize({ digest, count, totalChars: text.length });
    finalized.add(digest);
    return digest;
  })();
  inflight.set(digest, work);
  try { return await work; } finally { inflight.delete(digest); }
}

/** 测试用 */
export function __resetHandbookManuscriptStageForTest() { finalized.clear(); inflight.clear(); }
