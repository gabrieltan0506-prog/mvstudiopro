export type NativeDeepReadRelearn = {
  seriesKey: string;
  episodeIndex: number;
  requestId: string;
};

export function parseNativeDeepReadRelearn(value: unknown): NativeDeepReadRelearn | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("重学确认参数无效");
  const row = value as Record<string, unknown>;
  if (typeof row.seriesKey !== "string" || !/^[0-9A-Za-z_-]{1,40}$/.test(row.seriesKey)
    || typeof row.episodeIndex !== "number" || !Number.isInteger(row.episodeIndex)
    || row.episodeIndex < 1 || row.episodeIndex > 999
    || typeof row.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.requestId)) {
    throw new Error("重学确认必须绑定剧集、集号和本次提交标识");
  }
  return { seriesKey: row.seriesKey, episodeIndex: row.episodeIndex, requestId: row.requestId };
}
