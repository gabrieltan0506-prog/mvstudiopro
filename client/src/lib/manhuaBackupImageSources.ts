import type { ManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";

export type ManhuaBackupImageSource = {
  /** 快照原始来源；仅有长期身份的导演板保留 gs://，由调用方解析读链。 */
  sourceUrl: string;
  gcsUri?: string;
};

type BackupImageSnapshot = Pick<
  ManhuaCloudDraftPayload,
  "canvas" | "writerSession" | "factoryPrefs"
>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 只枚举现有快照的图片字段，不联网、不写缓存、不规范化或裁掉候选资产。
 * 同一来源只取一次字节；图片自身的长期身份可用于续签，但不替换快照原地址。
 */
export function collectManhuaBackupImageSources(
  payload: BackupImageSnapshot
): ManhuaBackupImageSource[] {
  const sources = new Map<string, ManhuaBackupImageSource>();
  const add = (rawUrl: unknown, rawGcsUri?: unknown) => {
    const gcsUri =
      typeof rawGcsUri === "string" && rawGcsUri.trim().startsWith("gs://")
        ? rawGcsUri.trim()
        : undefined;
    const sourceUrl =
      (typeof rawUrl === "string" ? rawUrl.trim() : "") || gcsUri;
    if (!sourceUrl) return;
    const previous = sources.get(sourceUrl);
    if (!previous) {
      sources.set(sourceUrl, { sourceUrl, ...(gcsUri ? { gcsUri } : {}) });
    } else if (!previous.gcsUri && gcsUri) {
      sources.set(sourceUrl, { ...previous, gcsUri });
    }
  };

  for (const rawBlock of list(record(payload.canvas).blocks)) {
    const block = record(rawBlock);
    if (block.kind === "video") continue;
    for (const field of [
      "outputUrl",
      "refImageUrl",
      "editMaskUrl",
      "lastFrameUrl",
    ])
      add(block[field]);
    for (const field of ["outputUrls", "editFusionUrls"]) {
      for (const url of list(block[field])) add(url);
    }
  }

  for (const container of [payload.writerSession, payload.factoryPrefs]) {
    for (const rawRef of list(record(container).customAssetRefs)) {
      const ref = record(rawRef);
      add(ref.url, ref.gcsUri);
      // 每格属于独立图片；主图 gcsUri 不能误挂到四格上。
      for (const url of Object.values(record(ref.tileUrls))) add(url);
    }
  }

  const addBoard = (rawBoard: unknown) => {
    if (typeof rawBoard === "string") {
      add(rawBoard, rawBoard.startsWith("gs://") ? rawBoard : undefined);
    } else {
      const board = record(rawBoard);
      add(board.url, board.gcsUri);
    }
  };
  const prefs = record(payload.factoryPrefs);
  for (const board of Object.values(record(prefs.directorBoardMainByEpisode))) {
    addBoard(board);
  }
  for (const segments of Object.values(record(prefs.directorBoardBySegment))) {
    for (const board of Object.values(record(segments))) addBoard(board);
  }
  return Array.from(sources.values());
}
