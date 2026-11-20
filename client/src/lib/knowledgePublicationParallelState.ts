import { completedKnowledgeBatches, knowledgeCompletedPrefix, type KnowledgePublicationParallel } from "@shared/knowledgePublicationParallel";

/**
 * 某一审校批收妥后的并发状态合并（纯函数，便于单测）。
 *
 * 为什么单独提出来：原面板写法 `parallel: { channels, completed }` 会把 parallel 的其他字段（family 等）丢掉；
 * 下一次合并保存后云稿缺 family，服务端为之后新发的批次与统稿修订按旧稿口径（DeepSeek 优先）组请求，
 * 违反 GLM@EvoLink → GLM@OpenRouter → DeepSeek 回落链。这里只覆盖 completed，其余字段原样保留。
 * 已存 request.json 的批次照旧按原请求回放，不受影响。
 */
export function knowledgeParallelAfterBatch<T extends { completedBatches: number; parallel?: KnowledgePublicationParallel }>(
  publication: T,
  batchIndex: number,
  batchCount: number,
): { publication: T; done: number } {
  if (!publication.parallel) throw new Error("并发整理状态缺失，已暂停");
  const completed = completedKnowledgeBatches(publication, batchCount);
  completed.add(batchIndex);
  return {
    publication: {
      ...publication,
      parallel: { ...publication.parallel, completed: Array.from(completed).sort((a, b) => a - b) },
      completedBatches: knowledgeCompletedPrefix(completed, batchCount),
    },
    done: completed.size,
  };
}
