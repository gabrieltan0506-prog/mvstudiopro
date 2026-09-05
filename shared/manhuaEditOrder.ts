/** 源镜号与播放位置分离；旧粗剪列表去重、剔除旧镜并补齐新增镜。 */
export function normalizeManhuaRoughShotOrder(
  shotIndexes: readonly number[],
  requested: readonly number[] = []
): number[] {
  const valid = new Set(
    shotIndexes.filter(index => Number.isSafeInteger(index) && index > 0)
  );
  return Array.from(
    new Set([...requested, ...shotIndexes].filter(index => valid.has(index)))
  );
}

/** 非法新值保留为 0，交给合成门禁拒绝，不能清掉后伪装成旧稿。 */
export function normalizeManhuaTimelineOrder(
  value: unknown
): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

export function stampManhuaTimelineOrder<T extends { shotIndex: number }>(
  pieces: readonly T[],
  order: readonly number[]
): Array<T & { timelineOrder: number }> {
  const positions = new Map(
    order.map((shotIndex, index) => [shotIndex, index + 1])
  );
  if (positions.size !== order.length)
    throw new Error("镜头顺序重复，请重新确认粗剪");
  return pieces.map(piece => {
    const timelineOrder = positions.get(piece.shotIndex);
    if (!timelineOrder) throw new Error("镜头顺序缺失，请重新确认粗剪");
    return { ...piece, timelineOrder };
  });
}

/** 只有完整且与当前分镜一致的画布顺序才能覆盖本机面板状态。 */
export function restoreManhuaRoughShotOrder(
  pieces: readonly { shotIndex: number; timelineOrder?: number }[],
  shotIndexes: readonly number[]
): number[] | undefined {
  if (
    !pieces.length ||
    !pieces.some(piece => piece.timelineOrder !== undefined)
  )
    return undefined;
  const sorted = [...pieces].sort(
    (a, b) => Number(a.timelineOrder) - Number(b.timelineOrder)
  );
  if (
    sorted.length !== new Set(shotIndexes).size ||
    sorted.some((piece, index) => piece.timelineOrder !== index + 1) ||
    new Set(sorted.map(piece => piece.shotIndex)).size !== sorted.length ||
    sorted.some(piece => !shotIndexes.includes(piece.shotIndex))
  )
    return undefined;
  return sorted.map(piece => piece.shotIndex);
}
