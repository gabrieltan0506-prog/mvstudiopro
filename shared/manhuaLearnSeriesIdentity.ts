import {
  extractDouyinVideoIdFromUrl,
  type DouyinEpisodeAccess,
} from "./manhuaLearnDouyinWebApi.js";

export type ManhuaLearnListedSource = {
  index: number;
  url: string;
  title: string;
  playbackUrl?: string;
  playbackUrls?: string[];
  access?: DouyinEpisodeAccess;
};

/** 直接视频达 60 分钟时按大合集源学习。 */
export function isManhuaCompilationDuration(durationSec: number): boolean {
  return Number.isFinite(durationSec) && durationSec >= 60 * 60;
}

const TITLE_PLACEHOLDERS = new Set(["未命名合集", "贴链接学习"]);

function stripBookTitleMarks(raw?: string | null): string {
  const title = String(raw || "").trim();
  const match = /^《(.*)》$/.exec(title);
  return match && !match[1].includes("《") && !match[1].includes("》")
    ? match[1].trim()
    : title;
}

/** 同名剧合并只忽略排版差异，不删「第二季」等业务语义。 */
export function normalizeManhuaSeriesTitle(raw?: string | null): string {
  const cleaned = TITLE_PLACEHOLDERS.has(String(raw || "").trim()) ? "" : raw;
  return stripBookTitleMarks(cleaned)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s《》「」『』【】]/g, "");
}

function sameEpisodeSource(left: string, right: string): boolean {
  const leftDouyinId = extractDouyinVideoIdFromUrl(left);
  const rightDouyinId = extractDouyinVideoIdFromUrl(right);
  if (leftDouyinId || rightDouyinId) {
    return Boolean(leftDouyinId && rightDouyinId && leftDouyinId === rightDouyinId);
  }
  return String(left || "").trim() === String(right || "").trim();
}

/** 同一大合集续用旧集号；同名新大合集追加到已有剧集后。 */
export function placeSingleSourceInExistingSeries<T extends ManhuaLearnListedSource>(
  listed: T[],
  /**
   * 已占用的集号与它们的**稳定来源**。
   *
   * 从 digest 数组改成这个形状，是因为原生精读**不产 digest** ——
   * 只按 digest 排集号时，同名剧第二次手动导入另一个视频会再落回 ep001，
   * 然后被已入库的 ep001 判成「已完成」，新素材一集都学不到。
   */
  existingSources: Array<{ episodeIndex: number; url: string }>,
  opts?: { sourceIdentity?: string },
): T[] {
  if (listed.length !== 1 || !existingSources.length) return listed;
  const only = listed[0]!;
  /**
   * GCS 手动导入时，运行时 URL 是短时签名 HTTPS（每次都不同），
   * 而卡片里存的是稳定 `gs://`。拿签名链去比对永远不相等 →
   * 同一素材重跑会被当成新素材追加。所以比对用调用方给的稳定标识。
   */
  const sourceIdentity = String(opts?.sourceIdentity || only.url).trim();
  const same = existingSources.find((source) => sameEpisodeSource(source.url, sourceIdentity));
  if (same) return [{ ...only, index: same.episodeIndex }];
  const occupied = existingSources.map((source) => source.episodeIndex);
  const maxOccupiedIndex = Math.max.apply(null, occupied);
  if (occupied.indexOf(only.index) === -1 && only.index > maxOccupiedIndex) return listed;
  return [{ ...only, index: maxOccupiedIndex + 1 }];
}
