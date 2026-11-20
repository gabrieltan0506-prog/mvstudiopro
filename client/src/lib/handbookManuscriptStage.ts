import { KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS, planKnowledgeCardPages } from "@shared/knowledgeCardPagination";

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
/** 逐页出图对同一本稿只算一次摘要与分页（整本数百万字，逐页重算会卡住页面）；只记最近一本 */
let memo: { text: string; digest?: Promise<string>; pages?: string[] } | null = null;
const memoFor = (text: string) => (memo && memo.text === text ? memo : (memo = { text }));

/** 大稿路径本页正文：与服务端核对用的同一分页函数 */
export function handbookManuscriptPageBody(text: string, pageIndex: number): string {
  const entry = memoFor(text);
  entry.pages ??= planKnowledgeCardPages(text).pages;
  return entry.pages[pageIndex - 1] ?? "";
}

/** 出图前准备链的步骤（2026-11-20）：每步开始时显示「出图前准备 第 x/y 步：…」，失败时说清是哪一步。 */
export const HANDBOOK_PREPARE_STEPS = ["规划分页", "上传大稿并报价", "核对稿件身份", "整理配图章节", "计算文字页数", "保存云端稿件并报价", "确认费用"] as const;
export type HandbookPrepareStep = (typeof HANDBOOK_PREPARE_STEPS)[number];
export function handbookPrepareStepLabel(step: HandbookPrepareStep, detail?: string): string {
  return `出图前准备 第 ${HANDBOOK_PREPARE_STEPS.indexOf(step) + 1}/${HANDBOOK_PREPARE_STEPS.length} 步：${step}${detail ? `（${detail}）` : ""}`;
}
/** 失败句：哪一步 + 原因 + 未扣费；原因已是中文业务句时原样保留。 */
export function handbookPrepareFailureMessage(step: HandbookPrepareStep, reason: string): string {
  return `出图前准备第 ${HANDBOOK_PREPARE_STEPS.indexOf(step) + 1} 步（${step}）未完成，尚未出图、未扣费：${reason || "请稍后重试"}`;
}

export async function stageHandbookManuscript(text: string, api: HandbookManuscriptStageApi, onProgress?: (uploaded: number, count: number) => void): Promise<string> {
  const entry = memoFor(text);
  const pending = entry.digest ??= handbookManuscriptDigest(text);
  let digest: string;
  try { digest = await pending; } catch (error) { if (entry.digest === pending) entry.digest = undefined; throw error; }
  if (finalized.has(digest)) return digest;
  const running = inflight.get(digest);
  if (running) return running;
  const work = (async () => {
    const size = KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS, count = Math.ceil(text.length / size);
    // 顺序上传：任一段失败即整体失败（不封存），再次调用从头幂等补齐
    onProgress?.(0, count);
    for (let index = 0; index < count; index++) {
      await api.stageChunk({ digest, index, count, totalChars: text.length, text: text.slice(index * size, (index + 1) * size) });
      onProgress?.(index + 1, count);
    }
    await api.finalize({ digest, count, totalChars: text.length });
    finalized.add(digest);
    return digest;
  })();
  inflight.set(digest, work);
  try { return await work; } finally { inflight.delete(digest); }
}

/** 测试用 */
export function __resetHandbookManuscriptStageForTest() { finalized.clear(); inflight.clear(); memo = null; }
