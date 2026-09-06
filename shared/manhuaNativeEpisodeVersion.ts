import type { ManhuaViralTemplateCard } from "./manhuaViralTemplateBank.js";

/** 请求快照标识输入配置，不标识本次输出；新版本以独立完整批次和持久化证据识别。 */
export function isCompleteNativeEpisodeRelearn(previousCard: ManhuaViralTemplateCard, nextCard: ManhuaViralTemplateCard): boolean {
  const previous = previousCard.provenance?.nativeVideoDeepRead;
  const next = nextCard.provenance?.nativeVideoDeepRead;
  const indexes = [...(next?.completedSegmentIndexes ?? [])].sort((a, b) => a - b);
  return Boolean(previous && next && previousCard.id === nextCard.id
    && previous.sourceDigest && previous.sourceDigest === next.sourceDigest
    && next.assemblyComplete && !next.truncated
    && next.attemptedSegments > 0 && next.successSegments === next.attemptedSegments
    && indexes.length === next.attemptedSegments && indexes.every((value, index) => value === index)
    && next.batchRequestId && previous.batchRequestId && next.batchRequestId !== previous.batchRequestId
    && Date.parse(nextCard.updatedAt ?? "") > Date.parse(previousCard.updatedAt ?? "")
    && (next.sourceDurationSec ?? 0) >= (previous.sourceDurationSec ?? 0)
    && next.segmentEvidenceObjectNames?.length === next.attemptedSegments
    && new Set(next.segmentEvidenceObjectNames).size === next.attemptedSegments
    && next.glmParsedObjectName);
}
