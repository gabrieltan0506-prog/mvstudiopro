import { resolveKnowledgeCardSubjectPosition, type KnowledgeCardSubjectPosition } from "@shared/knowledgeCardSubjectPosition";
import type { ActiveKnowledgeCardDistillModelId } from "@shared/knowledgeCardDistillModels";

export const KNOWLEDGE_CARD_MATERIAL_LIMIT = 50_000;
export type KnowledgeCardPending = { kind: "distill" | "image"; subjectPosition?: KnowledgeCardSubjectPosition; jobId?: string; pageIndex?: number; model: ActiveKnowledgeCardDistillModelId };
export type KnowledgeCardMaterialBatch = {
  id: string;
  source: string;
  draft: string;
  subjectPosition?: KnowledgeCardSubjectPosition;
  draftModel?: ActiveKnowledgeCardDistillModelId;
  images: { url: string; pageIndex: number; subjectPosition?: KnowledgeCardSubjectPosition }[];
  generation?: { subjectPosition?: KnowledgeCardSubjectPosition; draft: string; model: ActiveKnowledgeCardDistillModelId; pageTotal: number; completed: number[] };
  generationHistory?: NonNullable<KnowledgeCardMaterialBatch["generation"]>[];
  error?: string;
  pending?: KnowledgeCardPending;
};

/** 保留所有空白和标点；长度按UTF-16计数，不在代理对中间切开。 */
export function splitKnowledgeCardMaterial(source: string, limit = KNOWLEDGE_CARD_MATERIAL_LIMIT): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("分块长度至少为2");
  if (!source) return [""];
  const chunks: string[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + limit, source.length);
    if (end < source.length) {
      const floor = start + Math.floor(limit * 0.6);
      const window = source.slice(floor, end);
      const paragraph = window.lastIndexOf("\n");
      if (paragraph >= 0) end = floor + paragraph + 1;
      else {
        const boundaries = Array.from(window.matchAll(/[。！？!?；;](?:[”’"']?)/g));
        const last = boundaries.at(-1);
        if (last) end = floor + last.index! + last[0].length;
      }
      if (/[\uD800-\uDBFF]/.test(source[end - 1]) && /[\uDC00-\uDFFF]/.test(source[end])) end -= 1;
    }
    chunks.push(source.slice(start, end));
    start = end;
  }
  return chunks;
}

export function createKnowledgeCardMaterialBatches(source: string, subjectPosition?: KnowledgeCardSubjectPosition): KnowledgeCardMaterialBatch[] {
  return splitKnowledgeCardMaterial(source).map(part => ({ id: crypto.randomUUID(), source: part, subjectPosition: resolveKnowledgeCardSubjectPosition(subjectPosition), draft: "", images: [] }));
}

/** 第一块保留原稿和旧图供对照，新拆出的块不继承已付费结果。 */
export function editKnowledgeCardMaterialBatch(batches: KnowledgeCardMaterialBatch[], id: string, source: string): KnowledgeCardMaterialBatch[] {
  return batches.flatMap(batch => {
    if (batch.id !== id) return [batch];
    const parts = createKnowledgeCardMaterialBatches(source, batch.subjectPosition);
    return [{ ...batch, source: parts[0].source }, ...parts.slice(1)];
  });
}

/** 当前记录优先；历史位置/稿件不因切换而丢失已完成页。 */
export function findKnowledgeCardGeneration(batch: KnowledgeCardMaterialBatch, model: ActiveKnowledgeCardDistillModelId) {
  return [batch.generation, ...(batch.generationHistory || [])].find(g => g && g.draft === batch.draft && g.model === model && resolveKnowledgeCardSubjectPosition(g.subjectPosition) === resolveKnowledgeCardSubjectPosition(batch.subjectPosition));
}
export function archiveKnowledgeCardGeneration(batch: KnowledgeCardMaterialBatch) {
  const history = [...(batch.generationHistory || [])];
  if (batch.generation) {
    const old = batch.generation;
    const index = history.findIndex(g => g.draft === old.draft && g.model === old.model && resolveKnowledgeCardSubjectPosition(g.subjectPosition) === resolveKnowledgeCardSubjectPosition(old.subjectPosition));
    if (index >= 0) history[index] = old; else history.push(old);
  }
  return history;
}
export function knowledgeCardRemainingPages(batch: KnowledgeCardMaterialBatch, model: ActiveKnowledgeCardDistillModelId, pageTotal: number): number[] {
  const completed = findKnowledgeCardGeneration(batch, model)?.completed || [];
  return Array.from({ length: pageTotal }, (_, i) => i + 1).filter(page => !completed.includes(page));
}

export type KnowledgeCardMaterialSaved = { version: 1; batches: KnowledgeCardMaterialBatch[] };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isActiveModel = (value: unknown): value is ActiveKnowledgeCardDistillModelId => value === "gpt-5.6-sol" || value === "qwen3.8-max";
const isPage = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export function knowledgeCardDraftError(draft: string): string | undefined {
  return draft.length > KNOWLEDGE_CARD_MATERIAL_LIMIT
    ? `提炼稿共${draft.length.toLocaleString()}字符，超过50,000字符上限。请精简至上限内再生成；当前内容和旧图片已保留。`
    : undefined;
}

/** 畸形记录整体拒绝，保留原存储供核对，不能悄悄丢弃任务再开放付费。 */
export function parseKnowledgeCardMaterialSaved(raw: string): KnowledgeCardMaterialSaved {
  const saved: unknown = JSON.parse(raw);
  const fail = (): never => { throw new Error("草稿或任务记录格式无法识别，请先核对保存记录"); };
  if (!isRecord(saved) || saved.version !== 1 || !Array.isArray(saved.batches) || !saved.batches.length) return fail();
  const ids = new Set<string>();
  for (const batch of saved.batches) {
    if (!isRecord(batch) || typeof batch.id !== "string" || !batch.id.trim() || ids.has(batch.id)
      || typeof batch.source !== "string" || batch.source.length > KNOWLEDGE_CARD_MATERIAL_LIMIT
      || typeof batch.draft !== "string" || !Array.isArray(batch.images)
      || (batch.error !== undefined && typeof batch.error !== "string")
      || (batch.draftModel !== undefined && !isActiveModel(batch.draftModel))) return fail();
    ids.add(batch.id);
    resolveKnowledgeCardSubjectPosition(batch.subjectPosition);
    for (const image of batch.images) {
      if (!isRecord(image) || typeof image.url !== "string" || !/^https?:\/\//.test(image.url) || !isPage(image.pageIndex)) return fail();
      resolveKnowledgeCardSubjectPosition(image.subjectPosition);
      try { new URL(image.url); } catch { return fail(); }
    }
    const imageItems = batch.images as { url: string; pageIndex: number; subjectPosition?: KnowledgeCardSubjectPosition }[];
    const generation = batch.generation;
    if (batch.generationHistory !== undefined && !Array.isArray(batch.generationHistory)) return fail();
    for (const generation of [batch.generation, ...(Array.isArray(batch.generationHistory) ? batch.generationHistory : [])].filter(g => g !== undefined)) {
      if (!isRecord(generation)) return fail();
      resolveKnowledgeCardSubjectPosition(generation.subjectPosition);
      if (!isRecord(generation) || typeof generation.draft !== "string" || !isActiveModel(generation.model)
        || !isPage(generation.pageTotal) || !Array.isArray(generation.completed)
        || new Set(generation.completed).size !== generation.completed.length
        || generation.completed.some(page => !isPage(page) || page > Number(generation.pageTotal)
          || !imageItems.some(image => image.pageIndex === page
            && resolveKnowledgeCardSubjectPosition(image.subjectPosition) === resolveKnowledgeCardSubjectPosition(generation.subjectPosition)))) return fail();
    }
    const pending = batch.pending;
    if (pending !== undefined) {
      if (!isRecord(pending)) return fail();
      resolveKnowledgeCardSubjectPosition(pending.subjectPosition);
      if (!isRecord(pending) || !["distill", "image"].includes(String(pending.kind)) || !isActiveModel(pending.model)
        || (pending.jobId !== undefined && (typeof pending.jobId !== "string" || !pending.jobId.trim()))) return fail();
      if (pending.kind === "image" && (!isRecord(generation) || !isPage(pending.pageIndex)
        || pending.pageIndex > Number(generation.pageTotal) || pending.model !== generation.model
        || resolveKnowledgeCardSubjectPosition(pending.subjectPosition) !== resolveKnowledgeCardSubjectPosition(generation.subjectPosition)
        || (generation.completed as number[]).includes(pending.pageIndex))) return fail();
      if (pending.kind === "distill" && pending.pageIndex !== undefined) return fail();
    }
  }
  return saved as unknown as KnowledgeCardMaterialSaved;
}

/** 分页规则变化时保留已购页面，不能用新页码覆盖或补买旧稿。 */
export function knowledgeCardGenerationError(batch: KnowledgeCardMaterialBatch, model: ActiveKnowledgeCardDistillModelId, pageTotal: number): string | undefined {
  const generation = findKnowledgeCardGeneration(batch, model);
  return generation && generation.pageTotal !== pageTotal
    ? `本份原任务记录为${generation.pageTotal}页，当前分页为${pageTotal}页，已停止生成。请先核对已有结果和任务记录，不会自动重做。`
    : undefined;
}
