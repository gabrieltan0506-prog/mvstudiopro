export type SafeNativeTemplateProgress = {
  successSegments: number;
  attemptedSegments: number;
  assemblyComplete: boolean;
  /** 一基序号；例如已经完成第 1 段时，下一个是 2。 */
  nextSegmentIndex?: number;
};

type NativeProgressCardLike = {
  id?: string | null;
  provenance?: {
    nativeVideoDeepRead?: {
      successSegments?: number;
      attemptedSegments?: number;
      assemblyComplete?: boolean;
      completedSegmentIndexes?: number[];
    } | null;
  } | null;
};

export function parseNativeTemplateEpisodeIndex(id?: string | null): number | undefined {
  const match = String(id || "").match(/_ep(\d{1,6})$/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** owner 私有正式库可读 provenance；只取 UI 所需的进度，不把其它内部字段带进展示。 */
export function readApprovedNativeTemplateProgress(
  card: NativeProgressCardLike | null | undefined,
): SafeNativeTemplateProgress | undefined {
  const native = card?.provenance?.nativeVideoDeepRead;
  if (!native) return undefined;
  const attemptedSegments = Math.max(0, Math.floor(Number(native.attemptedSegments) || 0));
  const completedCount = Array.isArray(native.completedSegmentIndexes)
    ? new Set(native.completedSegmentIndexes.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < attemptedSegments,
      )).size
    : 0;
  const successSegments = Math.min(
    attemptedSegments,
    completedCount || Math.max(0, Math.floor(Number(native.successSegments) || 0)),
  );
  if (attemptedSegments <= 0 || successSegments <= 0) return undefined;
  const completedIndexes = Array.isArray(native.completedSegmentIndexes)
    ? new Set(native.completedSegmentIndexes.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < attemptedSegments,
      ))
    : new Set(Array.from({ length: successSegments }, (_, index) => index));
  const nextMissingZeroBased = Array.from(
    { length: attemptedSegments },
    (_, index) => index,
  ).find((index) => !completedIndexes.has(index));
  const assemblyComplete = native.assemblyComplete === true
    || successSegments >= attemptedSegments;
  return {
    successSegments,
    attemptedSegments,
    assemblyComplete,
    nextSegmentIndex: assemblyComplete || nextMissingZeroBased === undefined
      ? undefined
      : nextMissingZeroBased + 1,
  };
}

export function buildPendingNativeTemplateProgressCopy(params: {
  id?: string | null;
  progress?: SafeNativeTemplateProgress | null;
  approvedSuccessSegments?: number;
}): {
  optionSuffixZh: string;
  detailZh: string;
  approveButtonZh: string;
} | undefined {
  const progress = params.progress;
  if (!progress || progress.attemptedSegments <= 0 || progress.successSegments <= 0) {
    return undefined;
  }
  const episodeIndex = parseNativeTemplateEpisodeIndex(params.id);
  const episodeZh = episodeIndex ? `第${episodeIndex}集` : "本集";
  const completedZh = `${progress.successSegments}/${progress.attemptedSegments}段已完成`;
  const remainingSegments = Math.max(
    0,
    progress.attemptedSegments - progress.successSegments,
  );
  const approvedSuccessSegments = Math.max(
    0,
    Math.floor(Number(params.approvedSuccessSegments) || 0),
  );
  const isCompletionUpdate = approvedSuccessSegments > 0
    && progress.successSegments > approvedSuccessSegments;
  const pendingApprovalZh = isCompletionUpdate
    ? `待批准补全至${progress.successSegments}/${progress.attemptedSegments}`
    : "";
  const resumeZh = remainingSegments > 0
    ? `剩${remainingSegments}段断点续学`
    : "全段已完成";
  return {
    optionSuffixZh: [episodeZh, completedZh, pendingApprovalZh, resumeZh]
      .filter(Boolean)
      .join(" · "),
    detailZh: isCompletionUpdate
      ? `${episodeZh}已入库${approvedSuccessSegments}/${progress.attemptedSegments}段；本次已补全至${progress.successSegments}/${progress.attemptedSegments}段，批准后更新正式模板。${remainingSegments > 0 ? `之后从第${progress.nextSegmentIndex || progress.successSegments + 1}段继续学习。` : ""}`
      : `${episodeZh}已完成${progress.successSegments}/${progress.attemptedSegments}段；批准后保留当前成果。${remainingSegments > 0 ? `之后从第${progress.nextSegmentIndex || progress.successSegments + 1}段继续学习。` : ""}`,
    approveButtonZh: isCompletionUpdate
      ? `批准补全至${progress.successSegments}/${progress.attemptedSegments}`
      : `批准当前${progress.successSegments}/${progress.attemptedSegments}入库`,
  };
}

export function buildApprovedNativeTemplateBadge(
  progress: SafeNativeTemplateProgress | null | undefined,
): string | undefined {
  if (!progress) return undefined;
  return `${progress.successSegments}/${progress.attemptedSegments}段已入库`;
}
