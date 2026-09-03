export type ManhuaAssembleSegmentRef = {
  episodeIndex: number;
  segmentIndex: number;
};

export type ManhuaAssembleCompleteness = {
  complete: boolean;
  missing: ManhuaAssembleSegmentRef[];
  hintZh: string;
};

function normalize(rows: readonly ManhuaAssembleSegmentRef[]): ManhuaAssembleSegmentRef[] {
  const unique = new Map<string, ManhuaAssembleSegmentRef>();
  for (const row of rows) {
    const episodeIndex = Math.floor(Number(row.episodeIndex));
    const segmentIndex = Math.floor(Number(row.segmentIndex));
    if (episodeIndex < 1 || segmentIndex < 1) continue;
    unique.set(`${episodeIndex}:${segmentIndex}`, { episodeIndex, segmentIndex });
  }
  return Array.from(unique.values()).sort(
    (a, b) => a.episodeIndex - b.episodeIndex || a.segmentIndex - b.segmentIndex,
  );
}

/** 缺任一计划段就拒绝最终合成，防止把试片或半集误导出为整集。 */
export function inspectManhuaAssembleCompleteness(input: {
  planned: readonly ManhuaAssembleSegmentRef[];
  selected: readonly ManhuaAssembleSegmentRef[];
}): ManhuaAssembleCompleteness {
  const planned = normalize(input.planned);
  const selectedKeys = new Set(
    normalize(input.selected).map((row) => `${row.episodeIndex}:${row.segmentIndex}`),
  );
  const missing = planned.filter(
    (row) => !selectedKeys.has(`${row.episodeIndex}:${row.segmentIndex}`),
  );
  return {
    complete: missing.length === 0,
    missing,
    hintZh: missing.length
      ? `缺少${missing.map((row) => `第${row.episodeIndex}集第${row.segmentIndex}段`).join("、")}，不可导出半集`
      : "计划片段已齐",
  };
}
