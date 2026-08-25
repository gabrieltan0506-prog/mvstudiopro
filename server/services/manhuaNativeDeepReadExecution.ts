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
import crypto from "node:crypto";
import {
  isManhuaNativeDeepReadEnabled,
  runManhuaNativeDeepRead,
  type NativeDeepReadMediaNode,
  validateNativeDeepReadSegments,
  type NativeDeepReadRunError,
  type NativeDeepReadSegmentSpec,
} from "./manhuaNativeDeepReadRunner.js";
import {
  checkNativeDeepReadIngestable,
  ingestNativeDeepReadEpisode,
  listIngestedNativeDeepReadEpisodes,
  type NativeDeepReadIngestResult,
} from "./manhuaNativeDeepReadIngest.js";
import { acquireNativeDeepReadEpisodeClaim } from "./manhuaNativeDeepReadClaim.js";

export type NativeDeepReadEpisodeExecution = {
  seriesKey: string;
  episodeIndex: number;
  /**
   * 切片与预检实际用的地址（必须是 ffmpeg 能拉的 HTTPS）。
   *
   * ⚠️ 与下面的 `provenanceSourceRef` 分开，是因为**手动导入 GCS 素材**时
   * 主链会先把 `gs://` 换成 7 天签名 HTTPS —— 那种短链带 Signature/Expires，
   * 写进永久卡就是一条几天后必然失效、还泄露签名的溯源记录。
   */
  sourceUrl: string;
  /**
   * 落进卡片 `sourceRefs` 的**永久**来源标识。
   * 抖音来源与 `sourceUrl` 相同；GCS 导入必须是稳定的 `gs://`。
   * 缺省时回落 `sourceUrl`（保持既有行为）。
   */
  provenanceSourceRef?: string;
  durationSec: number;
  laneHintZh?: string;
  segments: readonly NativeDeepReadSegmentSpec[];
  /**
   * 该集当前可用的媒体节点（零成本，不下载）。
   *
   * 两种来源都走这里：batch 脚本传页面 URL 解析器，生产主链直接返回
   * 素材接入层已探测成功的直链（含它验证过的 Referer）——后者不能再解析一次。
   */
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  abortSignal?: AbortSignal;
};

/** 供测试注入假实现；生产走默认值，不额外开旁路 */
export type NativeDeepReadExecutionDeps = {
  run: typeof runManhuaNativeDeepRead;
  ingest: typeof ingestNativeDeepReadEpisode;
  listIngested: typeof listIngestedNativeDeepReadEpisodes;
  isEnabled: typeof isManhuaNativeDeepReadEnabled;
  acquireClaim: typeof acquireNativeDeepReadEpisodeClaim;
};

const defaultDeps: NativeDeepReadExecutionDeps = {
  run: runManhuaNativeDeepRead,
  ingest: ingestNativeDeepReadEpisode,
  listIngested: listIngestedNativeDeepReadEpisodes,
  isEnabled: isManhuaNativeDeepReadEnabled,
  acquireClaim: acquireNativeDeepReadEpisodeClaim,
};

/** 跑一集并入库。门禁不过直接抛，不写半截卡 */
export type NativeDeepReadEpisodeOutcomeCost = {
  /** 这一集实际发生的模型费用（门禁拒收也已经花掉了，必须记） */
  costCny: number;
  elapsedMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costCny: number;
    usingPlanQuota?: boolean;
    receiptComplete: boolean;
  };
};

export async function executeAndIngestNativeDeepReadEpisode(
  input: NativeDeepReadEpisodeExecution,
  deps: NativeDeepReadExecutionDeps = defaultDeps,
): Promise<NativeDeepReadIngestResult & NativeDeepReadEpisodeOutcomeCost> {
  if (!deps.isEnabled()) throw new Error("原生精读开关未开启");
  if (input.abortSignal?.aborted) throw new Error("用户已停止学习");

  // 单集入口也走同一份预检，不能只依赖批处理调用方。
  validateNativeDeepReadBatchPlan([input], { maxEpisodes: 1, seriesKey: input.seriesKey });

  // 原子占位必须在 runner 之前：#1295 的 ifGenerationMatch 在模型跑完之后，
  // 只能防卡片覆盖，防不了两个进程各付一次费
  const claim = await deps.acquireClaim(input.seriesKey, input.episodeIndex);
  const startedAt = Date.now();

  let result: Awaited<ReturnType<typeof runManhuaNativeDeepRead>>;
  try {
    result = await deps.run({
      resolveNodes: input.resolveNodes,
      segments: input.segments,
      sourceDurationSec: input.durationSec,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    const nativeError = error as NativeDeepReadRunError;
    const knownCost = Number(nativeError?.nativeDeepReadCostCny) || 0;
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      {
        costCny: knownCost,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: nativeError?.nativeDeepReadUsage,
      },
    );
  }
  const costCny = Number(result.usage?.costCny) || 0;
  if (input.abortSignal?.aborted) {
    throw Object.assign(new Error("用户已停止学习"), {
      costCny,
      elapsedMs: Date.now() - startedAt,
      nativeUsage: {
        ...result.usage,
        usingPlanQuota: result.usingPlanQuota,
        receiptComplete: true,
      },
    });
  }

  // 门禁在写之前：空卡、全段失败不进库。**钱已经花了，错误里要带上**
  const gate = checkNativeDeepReadIngestable(result);
  if (!gate.ok) {
    throw Object.assign(
      new Error(`第${input.episodeIndex}集未通过入库门禁：${gate.reasonZh}`),
      {
        costCny,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: {
          ...result.usage,
          usingPlanQuota: result.usingPlanQuota,
          receiptComplete: true,
        },
      },
    );
  }

  let stored: NativeDeepReadIngestResult;
  try {
    stored = await deps.ingest({
      seriesKey: input.seriesKey,
      episodeIndex: input.episodeIndex,
      sourceUrl: input.provenanceSourceRef || input.sourceUrl,
      durationSec: input.durationSec,
      laneHintZh: input.laneHintZh,
      result,
    });
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), { cause: error }),
      {
        costCny,
        elapsedMs: Date.now() - startedAt,
        nativeUsage: {
          ...result.usage,
          usingPlanQuota: result.usingPlanQuota,
          receiptComplete: true,
        },
      },
    );
  }

  // 卡已入库就是成功；占位清不掉不改判失败，下一轮会先被已入库卡跳过
  try {
    await claim.releaseAfterSuccess();
  } catch (e) {
    console.warn(
      "[nativeDeepRead] 成功卡已入库，占位清理待人工核对：",
      claim.objectName,
      e instanceof Error ? e.message : e,
    );
  }
  return {
    ...stored,
    costCny,
    elapsedMs: Date.now() - startedAt,
    usage: {
      ...result.usage,
      usingPlanQuota: result.usingPlanQuota,
      receiptComplete: true,
    },
  };
}

export type NativeDeepReadBatchEpisode = Omit<
  NativeDeepReadEpisodeExecution,
  "seriesKey" | "abortSignal"
>;

/**
 * `--limit` 省略时的默认集数。**不是硬上限** —— 一趟跑多少由发车人指定。
 *
 * 真正拦住误发的是确认码 ＋ `--max-calls`：不原样回填 segment 次数就发不出去。
 * 集数只是「没指定时别把整份清单一口气跑了」的默认值。
 */
export const NATIVE_DEEP_READ_DEFAULT_BATCH_EPISODES = 20;

/** 失控保险：清单误写成几千集时兜底，正常发车碰不到 */
export const NATIVE_DEEP_READ_BATCH_HARD_CEILING = 200;
/** 请求固定 fps=2 / max_frames=2000 → 单段理论完整覆盖上限 1000 秒 */
export const NATIVE_DEEP_READ_INPUT_FPS = 2;
export const NATIVE_DEEP_READ_MAX_FRAMES = 2_000;
export const NATIVE_DEEP_READ_MAX_SEGMENT_SEC = Math.floor(
  NATIVE_DEEP_READ_MAX_FRAMES / NATIVE_DEEP_READ_INPUT_FPS,
);

export type NativeDeepReadBatchPlan = {
  totalEpisodes: number;
  /** **计费单位是 segment 不是集** —— 20 集各 6 段就是 120 次模型调用 */
  totalSegments: number;
  totalDurationSec: number;
  /** 计划指纹：真跑必须带上它，保证发的就是干跑时确认过的那份 */
  planHash: string;
};

/**
 * 批次预检。**必须在 GCS 列举与任何模型动作之前**。
 *
 * 之前只在入库时才校验，于是清单里写两次第 1 集会**真的跑两次模型**
 * （实测 runner calls=2），非法集号也是先调用再失败 —— 钱已经花掉了。
 */
export function validateNativeDeepReadBatchPlan(
  episodes: readonly NativeDeepReadBatchEpisode[],
  opts: { maxEpisodes?: number; seriesKey?: string } = {},
): NativeDeepReadBatchPlan {
  if (!episodes.length) throw new Error("发车清单为空");
  const ceiling = Math.max(
    1,
    Math.floor(Number(opts.maxEpisodes) || NATIVE_DEEP_READ_BATCH_HARD_CEILING),
  );
  if (episodes.length > ceiling) {
    throw new Error(`本批 ${episodes.length} 集超过上限 ${ceiling} 集`);
  }
  if (episodes.length > NATIVE_DEEP_READ_BATCH_HARD_CEILING) {
    throw new Error(`单批最多 ${NATIVE_DEEP_READ_BATCH_HARD_CEILING} 集（失控保险）`);
  }
  const seen = new Set<number>();
  let totalSegments = 0;
  let totalDurationSec = 0;
  for (let index = 0; index < episodes.length; index += 1) {
    const episode = episodes[index]!;
    const ep = Number(episode.episodeIndex);
    if (!Number.isInteger(ep) || ep < 1 || ep > 999) {
      throw new Error(`第${index + 1}项 episodeIndex 必须是 1–999 整数`);
    }
    if (seen.has(ep)) throw new Error(`发车清单重复第${ep}集`);
    seen.add(ep);
    let source: URL;
    try {
      source = new URL(String(episode.sourceUrl || ""));
    } catch {
      throw new Error(`第${ep}集来源地址无效`);
    }
    if (source.protocol !== "https:") throw new Error(`第${ep}集来源必须是 HTTPS`);
    const duration = Number(episode.durationSec);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`第${ep}集时长无效`);
    const segments = validateNativeDeepReadSegments(episode.segments);
    for (const segment of segments) {
      if (segment.endSec > duration + 0.5) throw new Error(`第${ep}集切片超出片长`);
      const len = segment.endSec - segment.startSec;
      if (len > NATIVE_DEEP_READ_MAX_SEGMENT_SEC) {
        throw new Error(
          `第${ep}集单片 ${Math.round(len)}s 超过 ${NATIVE_DEEP_READ_MAX_SEGMENT_SEC}s，模型看不完整，请拆段`,
        );
      }
    }
    totalSegments += segments.length;
    totalDurationSec += duration;
  }
  const canonical = JSON.stringify({
    seriesKey: String(opts.seriesKey || ""),
    episodes: episodes.map(({ resolveNodes: _drop, ...rest }) => rest),
  });
  return {
    totalEpisodes: episodes.length,
    totalSegments,
    totalDurationSec,
    planHash: crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16),
  };
}

export type NativeDeepReadBatchOutcome = {
  episodeIndex: number;
  status: "ingested" | "skipped" | "failed" | "aborted";
  gcsUri?: string;
  errorZh?: string;
  /** 实际发生的模型费用；**门禁拒收也要记**，钱已经花了 */
  costCny: number;
  elapsedMs: number;
};

export type NativeDeepReadBatchResult = {
  outcomes: NativeDeepReadBatchOutcome[];
  ingestedCount: number;
  skippedCount: number;
  failedCount: number;
  /** 只统计成功卡就会把「花了钱但没入库」那部分算漏 */
  totalCostCny: number;
  totalElapsedMs: number;
  plan: NativeDeepReadBatchPlan;
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

  // 预检在 GCS 列举与任何模型动作之前：清单里写两次第 1 集会真的跑两次模型
  const plan = validateNativeDeepReadBatchPlan(input.episodes, { seriesKey: input.seriesKey });
  const alreadyIngested = await deps.listIngested(input.seriesKey);
  const outcomes: NativeDeepReadBatchOutcome[] = [];
  const batchStartedAt = Date.now();
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
        costCny: 0,
        elapsedMs: 0,
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
      // 第二层防重：本轮内成功过的集立刻进集合，同批次重复也不会再跑
      alreadyIngested.add(episode.episodeIndex);
      const ok: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "ingested",
        gcsUri: done.gcsUri,
        costCny: done.costCny,
        elapsedMs: done.elapsedMs,
      };
      outcomes.push(ok);
      await input.onProgress?.(ok);
    } catch (e) {
      // 中止不记成「这集失败」——那会让人以为素材有问题
      if (input.abortSignal?.aborted) {
        const carried = e as { costCny?: number; elapsedMs?: number };
        const stopped: NativeDeepReadBatchOutcome = {
          episodeIndex: episode.episodeIndex,
          status: "aborted",
          errorZh: "用户已停止学习",
          costCny: Number(carried?.costCny) || 0,
          elapsedMs: Number(carried?.elapsedMs) || 0,
        };
        outcomes.push(stopped);
        await input.onProgress?.(stopped);
        aborted = true;
        break;
      }
      const carried = e as { costCny?: number; elapsedMs?: number };
      const failed: NativeDeepReadBatchOutcome = {
        episodeIndex: episode.episodeIndex,
        status: "failed",
        errorZh: (e instanceof Error ? e.message : String(e)).slice(0, 200),
        costCny: Number(carried?.costCny) || 0,
        elapsedMs: Number(carried?.elapsedMs) || 0,
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
    totalCostCny: outcomes.reduce((sum, o) => sum + (o.costCny || 0), 0),
    totalElapsedMs: Date.now() - batchStartedAt,
    plan,
    aborted,
  };
}
