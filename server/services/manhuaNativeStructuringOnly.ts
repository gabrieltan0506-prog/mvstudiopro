import { parseManhuaLocalVideoSourceRef } from "../../shared/manhuaLocalVideoUpload.js";
import { downloadGcsObjectVersioned, getGcsBucketName } from "./gcs.js";
import { parseManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank.js";
import { nativeDeepReadProposalId } from "./manhuaNativeDeepReadIngest.js";
import { resolveNativeDeepReadCacheSourceDigest, type NativeDeepReadEpisodeExecution } from "./manhuaNativeDeepReadExecution.js";
import { readNativeDeepReadSegmentCacheEntry } from "./manhuaNativeDeepReadSegmentCache.js";
import { normalizeDouyinVideoUrl } from "../../shared/manhuaLearnYtdlp.js";

export type NativeStructuringStoredSource = {
  seriesKey: string; episodeIndex: number; segmentSeconds: number; videoFps: number;
  sourceUrl?: string; expectedSegmentCount?: number; storedPlan?: unknown;
};

/** 只读取持久卡片的原计划与帧；绝不重新解析源网站、探视频或抽帧。 */
export async function loadNativeStructuringOnlyEpisode(input: NativeStructuringStoredSource, deps: { download: typeof downloadGcsObjectVersioned; getBucket: typeof getGcsBucketName; readCache?: typeof readNativeDeepReadSegmentCacheEntry } = { download: downloadGcsObjectVersioned, getBucket: getGcsBucketName, readCache: readNativeDeepReadSegmentCacheEntry }): Promise<NativeDeepReadEpisodeExecution> {
  if (!/^[a-z0-9_-]{1,40}$/i.test(input.seriesKey)) throw new Error("原任务未保存有效系列身份，不能仅重新整形");
  const id = nativeDeepReadProposalId(input.seriesKey, input.episodeIndex);
  const read = async (directory: string) => {
    try {
      const stored = await deps.download({ gcsUri: `gs://${deps.getBucket()}/manhua-template-learn/${directory}/${id}.json` });
      return parseManhuaViralTemplateCard(JSON.parse(stored.buffer.toString("utf8")));
    } catch (error) {
      if (/gcs_(?:stat|download)_failed:404/.test(String(error))) return null;
      throw error;
    }
  };
  const proposal = await read("proposals");
  const approved = await read("approved");
  const card = proposal ?? approved;
  const native = card?.provenance?.nativeVideoDeepRead;
  // 原任务的持久计划优先；旧正式卡可能属于不同分片长度的上一轮学习。
  if (input.storedPlan !== undefined && input.storedPlan !== null) {
    const plan = input.storedPlan as { seriesKey?: string; episodes?: Array<{ episodeIndex: number; sourceUrl: string; durationSec: number; videoFps: number; segmentSeconds?: number; segments: Array<{ startSec: number; endSec: number }> }> };
    const storedEpisode = plan?.seriesKey === input.seriesKey && Array.isArray(plan.episodes)
      ? plan.episodes.find(row => row.episodeIndex === input.episodeIndex) : undefined;
    if (!storedEpisode || storedEpisode.videoFps !== input.videoFps || !Array.isArray(storedEpisode.segments) || !storedEpisode.segments.length
      || typeof storedEpisode.sourceUrl !== "string"
      || (!storedEpisode.sourceUrl.startsWith("https://") && !parseManhuaLocalVideoSourceRef(storedEpisode.sourceUrl))
      || !(storedEpisode.durationSec > 0)) {
      throw new Error("原任务持久计划身份或分片不完整，未读取视频");
    }
    const sourceDigest = await resolveNativeDeepReadCacheSourceDigest({ sourceRef: storedEpisode.sourceUrl,
      statSourceVersion: async () => { throw new Error("仅重新整形不访问媒体来源"); } });
    const matchingCard = [proposal, approved].find(row => row?.provenance?.nativeVideoDeepRead?.sourceDigest === sourceDigest
      && row.provenance.nativeVideoDeepRead.videoFps === input.videoFps
      && row.provenance.nativeVideoDeepRead.sourceDurationSec === storedEpisode.durationSec && row.evidenceFrames?.length);
    return { ...storedEpisode, localVideoUpload: parseManhuaLocalVideoSourceRef(storedEpisode.sourceUrl) || undefined,
      seriesKey: input.seriesKey, segmentSeconds: input.segmentSeconds,
      retainedEvidenceFrames: matchingCard?.evidenceFrames,
      resolveNodes: async () => { throw new Error("仅重新整形禁止读取源视频"); } };
  }
  if (!card) {
    // 历史单集任务尚未落卡：用原回执声明段数读取完整缓存信封，再按稳定来源摘要核验。
    if (input.sourceUrl && Number.isInteger(input.expectedSegmentCount) && Number(input.expectedSegmentCount) > 0 && Number(input.expectedSegmentCount) <= 32 && deps.readCache) {
      const sourceUrl = /(^|\.)douyin\.com$/i.test(new URL(input.sourceUrl).hostname) ? normalizeDouyinVideoUrl(input.sourceUrl) : input.sourceUrl;
      const sourceDigest = await resolveNativeDeepReadCacheSourceDigest({ sourceRef: sourceUrl,
        statSourceVersion: async () => { throw new Error("仅重新整形不访问媒体来源"); } });
      const entries = [];
      for (let index = 0; index < input.expectedSegmentCount!; index += 1) {
        const cached = await deps.readCache({ seriesKey: input.seriesKey, episodeIndex: input.episodeIndex, segmentIndex: index });
        if (!cached || cached.entry.sourceDigest !== sourceDigest) throw new Error("原任务无卡且段JSON不齐或来源不符，未读取视频");
        entries.push(cached.entry);
      }
      const segments = entries.map(entry => ({ startSec: entry.startSec, endSec: entry.endSec }));
      return { seriesKey: input.seriesKey, episodeIndex: input.episodeIndex, sourceUrl,
        localVideoUpload: parseManhuaLocalVideoSourceRef(sourceUrl) || undefined,
        durationSec: segments.at(-1)!.endSec, videoFps: input.videoFps, segmentSeconds: input.segmentSeconds, segments,
        resolveNodes: async () => { throw new Error("仅重新整形禁止读取源视频"); } };
    }
  }
  if (!card || card.id !== id || !native?.segmentSpans?.length || !native.sourceDurationSec
    || !native.sourceDigest || !card.sourceRefs[0]?.url || native.videoFps !== input.videoFps
    || native.segmentSpans.length !== native.attemptedSegments) {
    throw new Error("原卡缺少完整来源、分片计划或采样参数，不能仅重新整形；未读取视频");
  }
  const frames = card.evidenceFrames?.length ? card.evidenceFrames
    : approved?.provenance?.nativeVideoDeepRead?.sourceDigest === native.sourceDigest ? approved.evidenceFrames : undefined;
  return { seriesKey: input.seriesKey, episodeIndex: input.episodeIndex, sourceUrl: card.sourceRefs[0].url,
    localVideoUpload: parseManhuaLocalVideoSourceRef(card.sourceRefs[0].url) || undefined,
    durationSec: native.sourceDurationSec, segments: native.segmentSpans.map(row => ({ ...row })),
    segmentSeconds: input.segmentSeconds, videoFps: native.videoFps, retainedEvidenceFrames: frames,
    sourceMarkers: card.provenance?.sourceMarkers,
    resolveNodes: async () => { throw new Error("仅重新整形禁止读取源视频"); } };
}
