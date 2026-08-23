/**
 * 原生精读的**生产协调器**：runner 与入库之间那段一直缺的接线。
 *
 * 立此模块的原因（0824 审阅点破）：
 * runner 写完了、入库写完了，但 `runManhuaNativeDeepRead` 在全仓
 * **只被自己和它的测试引用** —— 没有任何生产调用点。
 * 也就是说 `MANHUA_NATIVE_DEEP_READ=1` 打开也不改变任何业务路径，
 * 更没有可执行的发车入口。「合并部署后按单发车」当时并不成立。
 *
 * 最小闭环：
 *   入口 → 列已入库集 → 逐集：解析真实媒体节点 → runner → 入库门禁 → 写卡
 *
 * 三条纪律写死在代码里，不靠调用方自觉：
 * 1. **开关不开就不跑**，避免误触发付费调用
 * 2. **已入库的集直接跳过**，重跑不重烧（断点续跑靠 #1295 的 GCS 列举）
 * 3. **中止立刻停**，且不把中止记成「这集失败了」
 */
import {
  isManhuaNativeDeepReadEnabled,
  runManhuaNativeDeepRead,
  type NativeDeepReadSegmentSpec,
} from "./manhuaNativeDeepReadRunner.js";
import {
  checkNativeDeepReadIngestable,
  ingestNativeDeepReadEpisode,
  listIngestedNativeDeepReadEpisodes,
  type NativeDeepReadIngestResult,
} from "./manhuaNativeDeepReadIngest.js";

export type NativeDeepReadEpisodeExecution = {
  seriesKey: string;
  episodeIndex: number;
  sourceUrl: string;
  durationSec: number;
  laneHintZh?: string;
  segments: readonly NativeDeepReadSegmentSpec[];
  /** 解析该集当前可用的 CDN 节点副本（零成本，不下载） */
  resolveNodes: () => Promise<string[]>;
  abortSignal?: AbortSignal;
};

/** 供测试注入假实现；生产走默认值，不额外开旁路 */
export type NativeDeepReadExecutionDeps = {
  run: typeof runManhuaNativeDeepRead;
  ingest: typeof ingestNativeDeepReadEpisode;
  listIngested: typeof listIngestedNativeDeepReadEpisodes;
  isEnabled: typeof isManhuaNativeDeepReadEnabled;
};

const defaultDeps: NativeDeepReadExecutionDeps = {
  run: runManhuaNativeDeepRead,
  ingest: ingestNativeDeepReadEpisode,
  listIngested: listIngestedNativeDeepReadEpisodes,
  isEnabled: isManhuaNativeDeepReadEnabled,
};

/** 跑一集并入库。门禁不过直接抛，不写半截卡 */
export async function executeAndIngestNativeDeepReadEpisode(
  input: NativeDeepReadEpisodeExecution,
  deps: NativeDeepReadExecutionDeps = defaultDeps,
): Promise<NativeDeepReadIngestResult> {
  if (!deps.isEnabled()) throw new Error("原生精读开关未开启");
  if (input.abortSignal?.aborted) throw new Error("用户已停止学习");

  const result = await deps.run({
    resolveNodes: input.resolveNodes,
    segments: input.segments,
    abortSignal: input.abortSignal,
  });
  if (input.abortSignal?.aborted) throw new Error("用户已停止学习");

  // 门禁在写之前：空卡、全段失败不进库
  const gate = checkNativeDeepReadIngestable(result);
  if (!gate.ok) {
    throw new Error(`第${input.episodeIndex}集未通过入库门禁：${gate.reasonZh}`);
  }

  return deps.ingest({
    seriesKey: input.seriesKey,
    episodeIndex: input.episodeIndex,
    sourceUrl: input.sourceUrl,
    durationSec: input.durationSec,
    laneHintZh: input.laneHintZh,
    result,
  });
}

export type NativeDeepReadBatchEpisode = Omit<
  NativeDeepReadEpisodeExecution,
  "seriesKey" | "abortSignal"
>;

export type NativeDeepReadBatchOutcome = {
  episodeIndex: number;
  status: "ingested" | "skipped" | "failed";
  gcsUri?: string;
  errorZh?: string;
};

export type NativeDeepReadBatchResult = {
  outcomes: NativeDeepReadBatchOutcome[];
  ingestedCount: number;
  skippedCount: number;
  failedCount: number;
  /** true = 中途被用户停掉，后面的集没跑 */
  aborted: boolean;
};

/**
 * 批量发车（20 集就走这里）。
 *
 * **先列已入库集再决定跑哪些** —— 这是不重烧的唯一依据；
 * 列不动时 `listIngestedNativeDeepReadEpisodes` 会抛错停手，
 * 不会把「未知」当成「没跑过」。
 *
 * 单集失败不拖垮整批（前面已付费入库的集都留着），但中止立刻停。
 */
export async function runNativeDeepReadBatch(input: {
  seriesKey: string;
  episodes: readonly NativeDeepReadBatchEpisode[];
  abortSignal?: AbortSignal;
  onProgress?: (outcome: NativeDeepReadBatchOutcome) => void | Promise<void>;
}, deps: NativeDeepReadExecutionDeps = defaultDeps): Promise<NativeDeepReadBatchResult> {
  if (!deps.isEnabled()) throw new Error("原生精读开关未开启");

  const alreadyIngested = await deps.listIngested(input.seriesKey);
  const outcomes: NativeDeepReadBatchOutcome[] = [];
  let aborted = false;

  for (const episode of input.episodes) {
    if (input.abortSignal?.aborted) {
      aborted = true;
      break;
    }
    if (alreadyIngested.has(episode.episodeIndex)) {
      const skipped: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "skipped",
      };
      outcomes.push(skipped);
      await input.onProgress?.(skipped);
      continue;
    }
    try {
      const done = await executeAndIngestNativeDeepReadEpisode(
        { ...episode, seriesKey: input.seriesKey, abortSignal: input.abortSignal },
        deps,
      );
      const ok: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "ingested",
        gcsUri: done.gcsUri,
      };
      outcomes.push(ok);
      await input.onProgress?.(ok);
    } catch (e) {
      // 中止不记成「这集失败」——那会让人以为素材有问题
      if (input.abortSignal?.aborted) {
        aborted = true;
        break;
      }
      const failed: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "failed",
        errorZh: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      };
      outcomes.push(failed);
      await input.onProgress?.(failed);
    }
  }

  return {
    outcomes,
    ingestedCount: outcomes.filter((o) => o.status === "ingested").length,
    skippedCount: outcomes.filter((o) => o.status === "skipped").length,
    failedCount: outcomes.filter((o) => o.status === "failed").length,
    aborted,
  };
}
