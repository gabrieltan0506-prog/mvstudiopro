import { extractDouyinVideoIdFromUrl } from "./manhuaLearnDouyinWebApi.js";
import type { ManhuaLearnEpisodeDigest } from "./manhuaTemplateLearnSeries.js";

export type ManhuaLearnListedSource = {
  index: number;
  url: string;
  title: string;
  playbackUrl?: string;
  playbackUrls?: string[];
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
  existingDigests: ManhuaLearnEpisodeDigest[],
): T[] {
  if (listed.length !== 1 || !existingDigests.length) return listed;
  const only = listed[0]!;
  const same = existingDigests.find((digest) => sameEpisodeSource(digest.url, only.url));
  if (same) return [{ ...only, index: same.episodeIndex }];
  const occupied = existingDigests.map((digest) => digest.episodeIndex);
  const maxOccupiedIndex = Math.max.apply(null, occupied);
  if (occupied.indexOf(only.index) === -1 && only.index > maxOccupiedIndex) return listed;
  return [{ ...only, index: maxOccupiedIndex + 1 }];
}
