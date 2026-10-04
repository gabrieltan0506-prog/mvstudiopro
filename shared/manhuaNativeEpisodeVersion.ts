import { parseManhua0996SourceUrl } from "./manhuaLearn0996Source.js";
import type { ManhuaViralTemplateCard } from "./manhuaViralTemplateBank.js";

/** 分批整形没有单一 GLM 文件；每段持久化证据和完整连续时间轴共同证明整集。 */
export function hasCompleteNativeSegmentEvidence(card: ManhuaViralTemplateCard): boolean {
  const n = card.provenance?.nativeVideoDeepRead;
  if (!n || !n.assemblyComplete || n.truncated || n.attemptedSegments <= 0
    || n.successSegments !== n.attemptedSegments || !/^[a-f0-9]{64}$/.test(n.snapshotSha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(n.sourceDigest ?? "") || !(n.sourceDurationSec! > 0)) return false;
  const spans = n.segmentSpans ?? [];
  if (spans.length !== n.attemptedSegments || spans.some((span, i) =>
    !Number.isFinite(span.startSec) || !Number.isFinite(span.endSec) || span.endSec <= span.startSec
    || Math.abs(span.startSec - (i ? spans[i - 1]!.endSec : 0)) > 0.01)
    || Math.abs(spans.at(-1)!.endSec - n.sourceDurationSec!) > 0.01) return false;
  const names = n.segmentEvidenceObjectNames ?? [];
  const prefix = `manhua-template-learn/segment-evidence/${card.id}/${n.sourceDigest}/`;
  const indexes = names.map(name => name.startsWith(prefix)
    ? /^seg(\d{1,6})-[a-f0-9]{64}(?:-(?:[a-f0-9]{16}|[a-f0-9]{64}))?\.json$/.exec(name.slice(prefix.length))?.[1]
    : undefined).map(value => value === undefined ? -1 : Number(value)).sort((a, b) => a - b);
  return indexes.length === n.attemptedSegments && indexes.every((value, i) => value === i);
}

function isSameEpisodeSource(previous: ManhuaViralTemplateCard, next: ManhuaViralTemplateCard): boolean {
  const a = previous.provenance?.nativeVideoDeepRead;
  const b = next.provenance?.nativeVideoDeepRead;
  if (a?.sourceDigest && a.sourceDigest === b?.sourceDigest) return true;
  // 缓存摘要仍绑定原 URL；仅允许已支持镜站的同一剧、同一集完整重学，不能泛化忽略域名。
  const oldRef = parseManhua0996SourceUrl(previous.sourceRefs[0]?.url ?? "");
  const newRef = parseManhua0996SourceUrl(next.sourceRefs[0]?.url ?? "");
  return Boolean(a?.sourceDigest && b?.sourceDigest && oldRef && newRef
    && oldRef.host !== newRef.host && oldRef.vodId === newRef.vodId && oldRef.nid === newRef.nid
    && a.sourceDurationSec === b.sourceDurationSec && hasCompleteNativeSegmentEvidence(next));
}

/** 没有单一整形文件时，提交重试必须连正文也一致，避免把同批次的编辑当作已提交。 */
export function isSameBatchedNativeEpisodeOutput(previous: ManhuaViralTemplateCard, next: ManhuaViralTemplateCard): boolean {
  if (!hasCompleteNativeSegmentEvidence(previous) || !hasCompleteNativeSegmentEvidence(next)) return false;
  const content = ({ status, publicCode, approvedAt, updatedAt, ...rest }: ManhuaViralTemplateCard) => rest;
  return JSON.stringify(content(previous)) === JSON.stringify(content(next));
}

/** 请求快照标识输入配置，不标识本次输出；新版本以独立完整批次和持久化证据识别。 */
export function isCompleteNativeEpisodeRelearn(previousCard: ManhuaViralTemplateCard, nextCard: ManhuaViralTemplateCard): boolean {
  const previous = previousCard.provenance?.nativeVideoDeepRead;
  const next = nextCard.provenance?.nativeVideoDeepRead;
  const indexes = [...(next?.completedSegmentIndexes ?? [])].sort((a, b) => a - b);
  return Boolean(previous && next && previousCard.id === nextCard.id
    && isSameEpisodeSource(previousCard, nextCard)
    && next.assemblyComplete && !next.truncated
    && next.attemptedSegments > 0 && next.successSegments === next.attemptedSegments
    && indexes.length === next.attemptedSegments && indexes.every((value, index) => value === index)
    && next.batchRequestId && previous.batchRequestId && next.batchRequestId !== previous.batchRequestId
    && Date.parse(nextCard.updatedAt ?? "") > Date.parse(previousCard.updatedAt ?? "")
    && (next.sourceDurationSec ?? 0) >= (previous.sourceDurationSec ?? 0)
    && next.segmentEvidenceObjectNames?.length === next.attemptedSegments
    && new Set(next.segmentEvidenceObjectNames).size === next.attemptedSegments
    && (next.glmParsedObjectName || hasCompleteNativeSegmentEvidence(nextCard)));
}
