import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import {
  hasManhuaTemplateClassificationFields,
  hasUsableManhuaTemplateClassification,
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateBeat,
  type ManhuaViralTemplateCard,
} from "../../shared/manhuaViralTemplateBank.js";
import type { ManhuaNativeModelReceipt } from "../../shared/manhuaNativeModelReceipt.js";
import {
  deleteGcsObject,
  downloadGcsObject,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import {
  NATIVE_DEEP_READ_PROPOSAL_PREFIX,
  nativeDeepReadProposalId,
  parseNativeDeepReadEpisodeIndex,
} from "./manhuaNativeDeepReadIngest.js";
import {
  GlmGatewayError,
  EVOLINK_GLM_MODEL,
  GLM_MODEL_GATEWAYS,
  type GlmGatewayName,
  OPENROUTER_GLM_MODEL,
  invokeGlmJsonChatWithGatewayFallback,
  type GlmGatewayUsage,
} from "./bailianChat.js";
import { nativeProviderReceiptFromError } from "./manhuaNativeProviderReceipt.js";

/**
 * 系列聚合的**链路标签**（0829 改线后主档是 EvoLink glm-5.3，兜底才是 OpenRouter）。
 * 与整形链同口径：两档都是 GLM-5.3，不换模型。
 */
export const MANHUA_NATIVE_SERIES_AGGREGATION_MODEL =
  `${EVOLINK_GLM_MODEL}→${OPENROUTER_GLM_MODEL}`;
export const MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE = "openrouter_text" as const;
export const MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION = "native-series-v2" as const;

const MAX_EPISODE_CARD_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_PAYLOAD_BYTES = 3 * 1024 * 1024;
const SNAPSHOT_DOWNLOAD_ATTEMPTS = 3;
const SNAPSHOT_DOWNLOAD_CONCURRENCY = 6;
const AGGREGATION_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
/**
 * 🔒 整条链的**总**墙钟预算（0830 审查 P1-1 修正）。
 *
 * 改线前 gatewayPolicy 是 openrouter_only（只有一档），12 分钟＝最坏耗时，
 * 20 分钟租约安全。0829 改成 glm_only 后变成 EvoLink→OpenRouter 两档，
 * 若按「每档 12 分钟」算，最坏 24 分钟 > 20 分钟租约 —— 第二档即使成功交卷，
 * assertOwnedForCommit 也必然抛「租约已失效」，**这笔已付费的聚合结果被整个丢弃**。
 * 今晚 EvoLink 撞 Cloudflare 524 已证明「第一档失败」不是假设。
 *
 * 修法：把 12 分钟当**整条链**的预算，进网关前算好 deadline 逐档扣减，
 * 而不是每档各给 12 分钟。这样两档合计仍在租约内，且保住「不设每档硬顶」的口径。
 */
const AGGREGATION_TIMEOUT_MS = 12 * 60_000;
const SERIES_LOCK_TTL_MS = 20 * 60_000;
/** 提交前至少还要剩这段租期；否则宁可停手，也不让临界过期的旧持有者覆盖新结果。 */
const SERIES_COMMIT_MIN_LEASE_MS = 2 * 60_000;
const OPENROUTER_USD_TO_CNY_EQUIVALENT = 7.2;

type SnapshotEpisode = {
  episodeIndex: number;
  objectName: string;
  generation: string;
  sha256: string;
  localFile: string;
};

export type NativeSeriesSnapshot = {
  dir: string;
  manifestPath: string;
  snapshotSha256: string;
  episodes: SnapshotEpisode[];
};

export type NativeSeriesAggregationUsage = {
  /**
   * **实际交卷**的模型 id（0830 审查 P1-2 修正）。
   * 原先钉成字面量 typeof MANHUA_NATIVE_SERIES_AGGREGATION_MODEL，
   * 结构上就不允许记真值 —— 账本上记的模型不是真跑的那个。
   * 改线后同一条链有两个不同 id（EvoLink `glm-5.3` / OpenRouter `z-ai/glm-5.3`）。
   */
  model: string;
  route: typeof MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  priceEquivalentCny: number;
  usingPlanQuota: false;
  receiptComplete: boolean;
};

export type NativeSeriesAggregationResult = {
  card: ManhuaViralTemplateCard;
  gcsUri: string;
  objectName: string;
  sourceEpisodeCount: number;
  snapshotSha256: string;
  reused: boolean;
  usage: NativeSeriesAggregationUsage;
};

export type NativeSeriesAggregationModelReceipt = Omit<
  ManhuaNativeModelReceipt,
  "stage" | "episodeIndexes"
> & {
  stage: "series_aggregation_model";
};

async function emitSeriesAggregationModelReceipt(
  receipt: NativeSeriesAggregationModelReceipt,
  callback?: (receipt: NativeSeriesAggregationModelReceipt) => void | Promise<void>,
): Promise<void> {
  console.info(`[nativeDeepReadModel] ${JSON.stringify(receipt)}`);
  try {
    await callback?.(receipt);
  } catch (error) {
    console.warn(
      "[nativeDeepReadModel] 系列整理回执写入未完成：",
      error instanceof Error ? error.message : error,
    );
  }
}

type AggregateGatewayResult = {
  raw: unknown;
  /** 实际交卷的网关与模型 id（0830 审查 P1-2：回执记真值，不用常量硬写）。 */
  gateway: GlmGatewayName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  provider?: string;
  providerRequestId?: string;
  finishReason?: string;
};

export type NativeSeriesAggregationError = Error & {
  nativeSeriesAggregationUsage?: NativeSeriesAggregationUsage;
};

type AggregateGatewayError = Error & { aggregateGatewayUsage?: Omit<AggregateGatewayResult, "raw"> };

export type NativeSeriesAggregationDeps = {
  listNames: typeof listGcsObjectNamesByPrefix;
  downloadVersioned: typeof downloadGcsObjectVersioned;
  download: typeof downloadGcsObject;
  upload: typeof uploadBufferToGcs;
  create: typeof uploadBufferToGcsIfAbsent;
  remove: typeof deleteGcsObject;
  invoke: (payloadJson: string, abortSignal?: AbortSignal) => Promise<AggregateGatewayResult>;
};

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error("用户已停止学习"));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason || new Error("用户已停止学习"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function writeAtomic(filePath: string, body: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const part = `${filePath}.part-${crypto.randomUUID()}`;
  const handle = await open(part, "wx", 0o600);
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(part, filePath);
}

function validateSeriesKey(seriesKey: string): string {
  const key = String(seriesKey || "").trim();
  // 与逐集卡唯一真源共用同一判据；调用一次即可拒绝非法 key。
  nativeDeepReadProposalId(key, 1);
  return key;
}

function nativeSeriesProposalId(seriesKey: string): string {
  return `tpl_native_series_${validateSeriesKey(seriesKey)}`;
}

function nativeSeriesProposalObjectName(seriesKey: string): string {
  return `${NATIVE_DEEP_READ_PROPOSAL_PREFIX}${nativeSeriesProposalId(seriesKey)}.json`;
}

function episodePrefix(seriesKey: string): string {
  return `${NATIVE_DEEP_READ_PROPOSAL_PREFIX}${nativeDeepReadProposalId(seriesKey, 1).replace(/ep001$/, "ep")}`;
}

function isGcsNotFound(error: unknown): boolean {
  return /(?:gcs_download_failed|gcs_stat_failed):404/.test(error instanceof Error ? error.message : String(error));
}

/**
 * OpenRouter GLM 收到全部分集证据 JSON，不收到 gs://、签名 URL 或 Fly 文件路径。
 * 禁止按集数缩小单集证据；上下文不足必须明确失败，不能静默抽稀。
 */
export function buildNativeSeriesAggregationPayload(cards: readonly ManhuaViralTemplateCard[]): string {
  if (!cards.length) throw new Error("没有可聚合的原生精读分集卡");
  const episodes = cards.map((card) => {
    const episodeIndex = Number(card.provenance?.nativeVideoDeepRead ? card.id.match(/_ep(\d{3})$/)?.[1] : 0);
    return {
      episodeIndex,
      summaryZh: card.summaryZh,
      hook3sZh: card.hook3sZh,
      classification: card.classification,
      reusableZh: card.reusableZh,
      genPromptHintZh: card.genPromptHintZh,
      beatGrid: [...card.beatGrid],
      subtitles: [...(card.subtitleTrack || [])],
      audioTrack: [...(card.audioStory?.audioTrack || [])],
      audioBeatStructureZh: card.audioStory?.audioBeatStructureZh || "",
      reusableAudioZh: card.audioStory?.reusableAudioZh || "",
    };
  }).sort((a, b) => a.episodeIndex - b.episodeIndex);
  const payload = JSON.stringify({
    schemaVersion: MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
    episodeCount: episodes.length,
    episodes,
  });
  if (Buffer.byteLength(payload) > MAX_SNAPSHOT_PAYLOAD_BYTES) {
    throw new Error("系列聚合快照超过输入上限，已停止而未静默裁切剧集");
  }
  return payload;
}

function buildAggregationPrompt(payloadJson: string): { system: string; user: string } {
  return {
    system: `你是收费漫剧模板的系列结构编辑。只根据输入 JSON 中可验证的分集证据，整理跨集可复用的故事与视听结构。只输出 JSON 对象。
硬规则：
1. 不复述外部剧名、平台名、角色专名或原台词；subtitles 只作证据，不得复制到输出。
2. 不使用“古言、种田、逆袭、系统、重生、甜宠”等旧题材桶。classification 的情绪、叙事、表演、视听、观众体验五个数组字段必须全部输出；没有真实证据的维度写 []，至少两个维度各保留一个真实标签，不得在单一维度堆标签冒充，也不得为凑满维度编造。
3. storyStructure 必须回答核心故事承诺、冲突如何持续、关系如何变化、跨集推进规律与避免重复的变化规则；不能只写钩子、压制、反转、爽点。
4. beatGrid 是跨集通用的结构节拍，不得拼接某一集原剧情；按证据需要完整输出，不设固定拍数上限。
5. 证据不足就删掉，不得猜；每个文本字段用客观陈述句。
6. 分集证据中 evidenceRole=non_story_ad 的镜头，以及任何与剧情无关的商业广告、贴片、带货、商品展示、品牌口播和商业推广/营销性内容（关注引导、点赞催更、解锁下集、平台导流、二维码等）：一律不得纳入聚合结果的任何字段（beatGrid、classification、storyStructure、reusableZh、genPromptHintZh、scenePoolHints 均不得引用）；发现输入卡残留广告内容时直接剔除，不得改写后保留。`,
    user: `请把以下同一剧目的全部分集快照重新聚合成一张系列模板。后续新增分集时会传入全部旧卡与新卡，必须基于全量重新计算，不得只追加最后一批。
输出字段：
{
  "nameZh":"中性且有辨识度的模板名",
  "summaryZh":"这套结构适合解决什么故事问题",
  "hook3sZh":"通用开场策略，不写来源台词",
  "classification":{"emotionTagsZh":[],"narrativeFeatureTagsZh":[],"performanceTagsZh":[],"audiovisualTagsZh":[],"audienceExperienceTagsZh":[]},
  "storyStructure":{"corePromiseZh":"","conflictEngineZh":"","relationshipEngineZh":"","episodeProgressionZh":[],"variationRulesZh":[]},
  "beatGrid":[{"atSec":0,"conflictZh":"","visualZh":""}],
  "reusableZh":"",
  "genPromptHintZh":"",
  "scenePoolHints":[],
  "castShape":{"leadDesireZh":"","pressureZh":"","foilZh":""},
  "densityHints":{"minBodyChars":280,"minDialogueLines":8,"minLocationHits":2}
}

分集快照 JSON：${payloadJson}`,
  };
}

function toAggregateGatewayUsage(
  usage: GlmGatewayUsage,
  /** 失败路径下最后一个真发出过的档的身份；取不到就退回链路标签，不假装知道。 */
  identity?: { gateway?: GlmGatewayName; model?: string },
): Omit<AggregateGatewayResult, "raw"> {
  return {
    gateway: identity?.gateway ?? "openrouter",
    model: identity?.model || MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    costUsd: usage.costUsd,
  };
}

/**
 * 系列任务只复用共用网关的 OpenRouter GLM 档。这里显式关闭 Qwen/EvoLink fallback，
 * 并把长系列所需的推理、参数支持、结束原因、墙钟与响应容量一次钉死。
 */
export async function invokeNativeSeriesAggregationModel(
  payloadJson: string,
  abortSignal?: AbortSignal,
): Promise<AggregateGatewayResult> {
  const prompt = buildAggregationPrompt(payloadJson);
  const chainStartedAt = Date.now();
  let raw: unknown = undefined;
  try {
    const response = await invokeGlmJsonChatWithGatewayFallback({
      system: prompt.system,
      user: prompt.user,
      maxTokens: 131_072,
      abortSignal,
      gatewayPolicy: "glm_only",
      // 整条链一个总预算：deadline 送进网关层，由它**每档实时**取 min(本档上限, 剩余)。
      // ⚠️ 0830 血账：上一版在这里自己算 `AGGREGATION_TIMEOUT_MS - (Date.now() - chainStartedAt)`，
      // 而 chainStartedAt 与这行在同一个同步块、中间无 await，差值恒为 0 → 传出去仍是满额，
      // 且网关层每档重读同一个 params，两档各拿满 12 分钟——**那是空改**。
      timeoutMs: AGGREGATION_TIMEOUT_MS,
      deadlineAtMs: chainStartedAt + AGGREGATION_TIMEOUT_MS,
      reasoningEffort: "max",
      requireParameters: true,
      requireFinishReasonStop: true,
      maxResponseBytes: AGGREGATION_RESPONSE_MAX_BYTES,
      validateContent: (content) => {
        try {
          raw = JSON.parse(content);
        } catch {
          throw new Error("系列聚合返回的业务 JSON 无法解析");
        }
      },
    });
    // 通道锁复用单一真源集合：只接受仍是 GLM-5.3 的两档，绝不接受 Qwen 兜底。
    if (!GLM_MODEL_GATEWAYS.has(response.gateway)) {
      throw new Error(`系列聚合模型锁失效（${response.gateway}）`);
    }
    return {
      raw,
      // 0830 审查 P1-2：带出**实际交卷**的网关与模型，回执不再由调用方拿常量硬写。
      gateway: response.gateway,
      model: response.model,
      inputTokens: Math.max(0, Number(response.usage?.prompt_tokens) || 0),
      outputTokens: Math.max(0, Number(response.usage?.completion_tokens) || 0),
      reasoningTokens: Math.max(
        0,
        Number(response.usage?.completion_tokens_details?.reasoning_tokens) || 0,
      ),
      costUsd: Math.max(0, Number(response.usage?.cost) || 0),
      provider: String(response.provider || "").trim() || undefined,
      providerRequestId: String(response.requestId || "").trim() || undefined,
      finishReason: String(response.choices?.[0]?.finish_reason || "").trim() || undefined,
    };
  } catch (error) {
    // 0830 审查 P1-1：真实身份就在 trace 里——取最后一个**真发出去过**的档。
    // 旧版 identity 参数从来没有调用方传，恒定落到假默认「openrouter + 链路标签」，
    // 等于在账本里编故事。
    const lastAttempted = error instanceof GlmGatewayError
      ? [...error.gatewayTrace].reverse().find((row) =>
          row.outcome !== "skipped_not_configured" && row.outcome !== "skipped_budget_exhausted")
      : undefined;
    const gatewayUsage = error instanceof GlmGatewayError
      ? toAggregateGatewayUsage(error.usage, lastAttempted)
      : undefined;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      aggregateGatewayUsage: gatewayUsage,
    }) as AggregateGatewayError;
  }
}

const defaultDeps: NativeSeriesAggregationDeps = {
  listNames: listGcsObjectNamesByPrefix,
  downloadVersioned: downloadGcsObjectVersioned,
  download: downloadGcsObject,
  upload: uploadBufferToGcs,
  create: uploadBufferToGcsIfAbsent,
  remove: deleteGcsObject,
  invoke: invokeNativeSeriesAggregationModel,
};

type NativeSeriesAggregationLease = {
  assertOwnedForCommit: () => Promise<void>;
  release: () => Promise<void>;
};

async function acquireSeriesAggregationLock(
  seriesKey: string,
  deps: NativeSeriesAggregationDeps,
): Promise<NativeSeriesAggregationLease> {
  const bucket = getGcsBucketName();
  const objectName = `manhua-template-learn/locks/native-series-${validateSeriesKey(seriesKey)}.json`;
  const gcsUri = `gs://${bucket}/${objectName}`;
  const attempt = async (): Promise<NativeSeriesAggregationLease | null> => {
    const token = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    const lease = { token, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SERIES_LOCK_TTL_MS).toISOString() };
    const created = await deps.create({
      bucket,
      objectName,
      buffer: Buffer.from(JSON.stringify(lease)),
      contentType: "application/json",
    });
    if (!created.created) return null;
    const saved = await deps.downloadVersioned({ gcsUri });
    const parsed = JSON.parse(saved.buffer.toString("utf8")) as { token?: string };
    if (parsed.token !== token) throw new Error("系列聚合锁内容不一致");
    return {
      assertOwnedForCommit: async () => {
        const current = await deps.downloadVersioned({ gcsUri });
        let currentLease: { token?: string; expiresAt?: string };
        try {
          currentLease = JSON.parse(current.buffer.toString("utf8")) as {
            token?: string;
            expiresAt?: string;
          };
        } catch {
          throw new Error("系列聚合租约已损坏，旧任务禁止提交");
        }
        const expiresAt = Date.parse(String(currentLease.expiresAt || ""));
        if (
          current.generation !== saved.generation
          || currentLease.token !== token
          || !Number.isFinite(expiresAt)
          || expiresAt - Date.now() < SERIES_COMMIT_MIN_LEASE_MS
        ) {
          throw new Error("系列聚合租约已失效或即将过期，旧任务禁止覆盖新结果");
        }
      },
      release: () => deps.remove({ bucket, objectName, ifGenerationMatch: saved.generation }),
    };
  };
  const first = await attempt();
  if (first) return first;
  const existing = await deps.downloadVersioned({ gcsUri });
  const lease = JSON.parse(existing.buffer.toString("utf8")) as { expiresAt?: string };
  if (!(Date.parse(String(lease.expiresAt || "")) <= Date.now())) {
    throw new Error("同一剧目正在生成系列模板，请稍后查看，勿重复提交");
  }
  await deps.remove({ bucket, objectName, ifGenerationMatch: existing.generation });
  const second = await attempt();
  if (!second) throw new Error("同一剧目刚被另一任务接管，请稍后查看");
  return second;
}

async function listNativeSeriesEpisodeObjectNames(
  seriesKey: string,
  deps: NativeSeriesAggregationDeps,
): Promise<string[]> {
  const names = (await deps.listNames({
    prefix: episodePrefix(seriesKey),
    maxResults: 1000,
    literalPrefix: true,
  }))
    .filter((name) => parseNativeDeepReadEpisodeIndex(name, seriesKey))
    .sort();
  if (!names.length) throw new Error("GCS 中没有可聚合的原生精读分集卡");
  if (names.length >= 1000) throw new Error("分集卡达到列举上限，无法证明系列快照完整");
  return names;
}

async function assertNativeSeriesSnapshotCurrent(
  seriesKey: string,
  snapshot: NativeSeriesSnapshot,
  deps: NativeSeriesAggregationDeps,
): Promise<void> {
  const expectedNames = snapshot.episodes.map((episode) => episode.objectName).sort();
  const assertSameNames = (currentNames: readonly string[]) => {
    if (
      currentNames.length !== expectedNames.length
      || currentNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new Error("系列分集在快照完成后发生变化，旧快照禁止提交；请按最新全量重试");
    }
  };

  assertSameNames(await listNativeSeriesEpisodeObjectNames(seriesKey, deps));
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(SNAPSHOT_DOWNLOAD_CONCURRENCY, snapshot.episodes.length) },
    async () => {
      while (cursor < snapshot.episodes.length) {
        const episode = snapshot.episodes[cursor++]!;
        const current = await deps.downloadVersioned({
          gcsUri: `gs://${getGcsBucketName()}/${episode.objectName}`,
        });
        if (current.generation !== episode.generation) {
          throw new Error(
            `第${episode.episodeIndex}集在模型运行期间已换版，旧快照禁止提交；请按最新全量重试`,
          );
        }
      }
    },
  ));
  // generation 核对期间也可能有新分集写入，列名再封一次口。
  assertSameNames(await listNativeSeriesEpisodeObjectNames(seriesKey, deps));
}

async function downloadEpisodeWithRetry(input: {
  seriesKey: string;
  objectName: string;
  dir: string;
  abortSignal?: AbortSignal;
  deps: NativeSeriesAggregationDeps;
}): Promise<{ snapshot: SnapshotEpisode; card: ManhuaViralTemplateCard }> {
  const episodeIndex = parseNativeDeepReadEpisodeIndex(input.objectName, input.seriesKey);
  if (!episodeIndex) throw new Error(`分集对象名不属于当前系列：${input.objectName}`);
  let lastError: unknown;
  for (let attempt = 1; attempt <= SNAPSHOT_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      if (input.abortSignal?.aborted) throw input.abortSignal.reason || new Error("用户已停止学习");
      const downloaded = await input.deps.downloadVersioned({
        gcsUri: `gs://${getGcsBucketName()}/${input.objectName}`,
      });
      if (!downloaded.buffer.length || downloaded.buffer.length > MAX_EPISODE_CARD_BYTES) {
        throw new Error("分集卡大小超出范围");
      }
      const raw = JSON.parse(downloaded.buffer.toString("utf8"));
      const card = parseManhuaViralTemplateCard(raw);
      if (
        !card
        || !hasManhuaTemplateClassificationFields(
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>).classification
            : undefined,
        )
        || card.id !== nativeDeepReadProposalId(input.seriesKey, episodeIndex)
        || !card.provenance?.nativeVideoDeepRead
        || card.provenance.nativeVideoDeepRead.assemblyComplete !== true
        || card.provenance.nativeVideoDeepRead.successSegments
          !== card.provenance.nativeVideoDeepRead.attemptedSegments
        || !hasUsableManhuaTemplateClassification(card.classification)
      ) {
        throw new Error("分集卡结构、身份或多维标签无效");
      }
      const normalized = Buffer.from(`${JSON.stringify(card)}\n`, "utf8");
      const digest = sha256(normalized);
      const localFile = path.join(input.dir, `ep${String(episodeIndex).padStart(3, "0")}.json`);
      await writeAtomic(localFile, normalized);
      const reread = await readFile(localFile);
      if (sha256(reread) !== digest || !parseManhuaViralTemplateCard(JSON.parse(reread.toString("utf8")))) {
        throw new Error("Fly 本机快照回读校验失败");
      }
      return {
        card,
        snapshot: {
          episodeIndex,
          objectName: input.objectName,
          generation: downloaded.generation,
          sha256: digest,
          localFile,
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt < SNAPSHOT_DOWNLOAD_ATTEMPTS) await sleep(250 * attempt, input.abortSignal);
    }
  }
  throw new Error(`第${episodeIndex}集转存 Fly 快照失败：${lastError instanceof Error ? lastError.message : lastError}`);
}

export async function stageNativeSeriesSnapshot(input: {
  seriesKey: string;
  abortSignal?: AbortSignal;
}, deps: NativeSeriesAggregationDeps = defaultDeps): Promise<{ snapshot: NativeSeriesSnapshot; cards: ManhuaViralTemplateCard[] }> {
  const seriesKey = validateSeriesKey(input.seriesKey);
  const names = await listNativeSeriesEpisodeObjectNames(seriesKey, deps);
  const dir = await mkdtemp(path.join(os.tmpdir(), `manhua-native-series-${seriesKey}-`));
  try {
    const rows: Array<{ snapshot: SnapshotEpisode; card: ManhuaViralTemplateCard }> = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(SNAPSHOT_DOWNLOAD_CONCURRENCY, names.length) }, async () => {
      while (cursor < names.length) {
        const objectName = names[cursor++]!;
        rows.push(await downloadEpisodeWithRetry({ ...input, seriesKey, objectName, dir, deps }));
      }
    }));
    rows.sort((a, b) => a.snapshot.episodeIndex - b.snapshot.episodeIndex);
    const manifestBody = Buffer.from(`${JSON.stringify({
      schemaVersion: MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
      seriesKey,
      episodes: rows.map((row) => ({
        episodeIndex: row.snapshot.episodeIndex,
        objectName: row.snapshot.objectName,
        generation: row.snapshot.generation,
        sha256: row.snapshot.sha256,
      })),
    })}\n`, "utf8");
    const manifestPath = path.join(dir, "manifest.json");
    await writeAtomic(manifestPath, manifestBody);
    return {
      cards: rows.map((row) => row.card),
      snapshot: {
        dir,
        manifestPath,
        snapshotSha256: sha256(manifestBody),
        episodes: rows.map((row) => row.snapshot),
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function readExistingSeriesCard(
  seriesKey: string,
  deps: NativeSeriesAggregationDeps,
): Promise<ManhuaViralTemplateCard | null> {
  try {
    const { buffer } = await deps.download({
      gcsUri: `gs://${getGcsBucketName()}/${nativeSeriesProposalObjectName(seriesKey)}`,
    });
    return parseManhuaViralTemplateCard(JSON.parse(buffer.toString("utf8")));
  } catch (error) {
    if (isGcsNotFound(error)) return null;
    throw error;
  }
}

function buildSeriesCard(input: {
  seriesKey: string;
  raw: unknown;
  cards: readonly ManhuaViralTemplateCard[];
  snapshotSha256: string;
  usage: NativeSeriesAggregationUsage;
}): ManhuaViralTemplateCard {
  const indexes = input.cards
    .map((card) => Number(card.id.match(/_ep(\d{3})$/)?.[1]))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
  const raw = input.raw as Record<string, unknown>;
  if (!hasManhuaTemplateClassificationFields(raw.classification)) {
    throw new Error("系列聚合结果的 classification 必须显式包含五个数组字段");
  }
  const aggregatedAt = new Date().toISOString();
  const card = parseManhuaViralTemplateCard({
    ...raw,
    id: nativeSeriesProposalId(input.seriesKey),
    laneZh: "多维标签",
    status: "proposed",
    sourceRefs: input.cards.map((sourceCard) => ({
      url: `gs://${getGcsBucketName()}/${NATIVE_DEEP_READ_PROPOSAL_PREFIX}${sourceCard.id}.json`,
      fetchedAt: aggregatedAt,
      noteZh: "原生精读分集证据卡",
    })),
    updatedAt: aggregatedAt,
    provenance: {
      nativeSeriesAggregation: {
        model: input.usage.model,
        route: input.usage.route,
        sourceEpisodeCount: input.cards.length,
        firstEpisodeIndex: indexes[0] || 0,
        lastEpisodeIndex: indexes[indexes.length - 1] || 0,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        costUsd: input.usage.costUsd,
        priceEquivalentCny: input.usage.priceEquivalentCny,
        usingPlanQuota: false,
        snapshotSha256: input.snapshotSha256,
        aggregatedAt,
      },
    },
  });
  if (!card) throw new Error("系列聚合结果未通过模板 schema");
  if (!hasUsableManhuaTemplateClassification(card.classification)) {
    throw new Error("系列聚合结果至少需要两个有效分类维度");
  }
  if (!card.storyStructure) throw new Error("系列聚合结果缺少完整故事骨架");
  if (card.beatGrid.length < 6) throw new Error("系列聚合结果的通用节拍不足 6 拍");
  return card;
}

/** 仅供契约测试验证系列卡不会在最后组装时静默丢分集来源。 */
export const __testBuildNativeSeriesCard = buildSeriesCard;

/**
 * GCS 分集卡 → Fly 原子快照 → OpenRouter GLM-5.3 JSON 文本聚合 → 系列待审卡。
 * 任一步失败都不覆盖上一版系列卡；本地快照无论成败都会清理。
 */
export async function aggregateNativeDeepReadSeries(input: {
  seriesKey: string;
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeSeriesAggregationModelReceipt) => void | Promise<void>;
}, deps: NativeSeriesAggregationDeps = defaultDeps): Promise<NativeSeriesAggregationResult> {
  // 慢的 GCS→Fly 快照先在锁外完成；锁只覆盖快照确认、模型调用与最终提交。
  // 这样 999 集下载不会吃掉 20 分钟租约的大半，提交前也还有明确的 fencing 检查。
  const staged = await stageNativeSeriesSnapshot(input, deps);
  let lease: NativeSeriesAggregationLease | undefined;
  let observedUsage: NativeSeriesAggregationUsage | undefined;
  try {
    lease = await acquireSeriesAggregationLock(input.seriesKey, deps);
    const currentNames = await listNativeSeriesEpisodeObjectNames(input.seriesKey, deps);
    const stagedNames = staged.snapshot.episodes.map((episode) => episode.objectName).sort();
    if (
      currentNames.length !== stagedNames.length
      || currentNames.some((name, index) => name !== stagedNames[index])
    ) {
      throw new Error("系列分集在快照完成后发生变化，未调用模型；请按最新全量重试");
    }
    const existing = await readExistingSeriesCard(input.seriesKey, deps);
    if (existing?.provenance?.nativeSeriesAggregation?.snapshotSha256 === staged.snapshot.snapshotSha256) {
      return {
        card: existing,
        gcsUri: `gs://${getGcsBucketName()}/${nativeSeriesProposalObjectName(input.seriesKey)}`,
        objectName: nativeSeriesProposalObjectName(input.seriesKey),
        sourceEpisodeCount: staged.cards.length,
        snapshotSha256: staged.snapshot.snapshotSha256,
        reused: true,
        usage: {
          model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
          route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          priceEquivalentCny: 0,
          usingPlanQuota: false,
          receiptComplete: true,
        },
      };
    }
    // 模型输入从已经落地且回读过的 Fly 文件重新组装，不复用 GCS 下载时的内存对象。
    const cards = await Promise.all(staged.snapshot.episodes.map(async (episode) => {
      const bytes = await readFile(episode.localFile);
      if (sha256(bytes) !== episode.sha256) throw new Error(`第${episode.episodeIndex}集 Fly 快照校验失败`);
      const card = parseManhuaViralTemplateCard(JSON.parse(bytes.toString("utf8")));
      if (!card) throw new Error(`第${episode.episodeIndex}集 Fly 快照无法解析`);
      return card;
    }));
    const payloadJson = buildNativeSeriesAggregationPayload(cards);
    const modelStartedAt = Date.now();
    const modelCallId = crypto.randomUUID();
    await emitSeriesAggregationModelReceipt({
      callId: modelCallId,
      model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
      route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
      stage: "series_aggregation_model",
      status: "started",
    }, input.onModelReceipt);
    let gateway: AggregateGatewayResult;
    try {
      gateway = await deps.invoke(payloadJson, input.abortSignal);
      await emitSeriesAggregationModelReceipt({
        callId: modelCallId,
        // 0830 审查 P1-2：completed 记实际交卷模型；started 才用链路标签。
        model: gateway.model,
        route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
        provider: gateway.provider,
        providerRequestId: gateway.providerRequestId,
        stage: "series_aggregation_model",
        status: "completed",
        elapsedMs: Date.now() - modelStartedAt,
        inputTokens: gateway.inputTokens,
        outputTokens: gateway.outputTokens,
        reasoningTokens: gateway.reasoningTokens,
        costUsd: gateway.costUsd,
        priceEquivalentCny: gateway.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT,
        finishReason: gateway.finishReason,
      }, input.onModelReceipt);
    } catch (error) {
      const gatewayUsage = (error as AggregateGatewayError).aggregateGatewayUsage;
      const providerError = nativeProviderReceiptFromError(error)
        || (error instanceof GlmGatewayError
          ? [...error.gatewayTrace].reverse().find((row) => row.providerError)?.providerError
          : undefined);
      await emitSeriesAggregationModelReceipt({
        callId: modelCallId,
        model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
        route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
        stage: "series_aggregation_model",
        status: "failed",
        elapsedMs: Date.now() - modelStartedAt,
        inputTokens: gatewayUsage?.inputTokens,
        outputTokens: gatewayUsage?.outputTokens,
        reasoningTokens: gatewayUsage?.reasoningTokens,
        costUsd: gatewayUsage?.costUsd,
        priceEquivalentCny: gatewayUsage
          ? gatewayUsage.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT
          : undefined,
        errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        providerError,
      }, input.onModelReceipt);
      throw error;
    }
    const usage: NativeSeriesAggregationUsage = {
      // 0830 审查 P0-2：这份 usage 会经 buildSeriesCard 永久写进系列卡 provenance。
      // 上一版只修了临时回执（看得见的那条），漏了这条落库的（留得下的那条）。
      model: gateway.model,
      route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
      inputTokens: gateway.inputTokens,
      outputTokens: gateway.outputTokens,
      reasoningTokens: gateway.reasoningTokens,
      costUsd: gateway.costUsd,
      priceEquivalentCny: gateway.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT,
      usingPlanQuota: false,
      receiptComplete: gateway.inputTokens > 0 && gateway.outputTokens > 0,
    };
    observedUsage = usage;
    if (!usage.receiptComplete) throw new Error("OpenRouter GLM-5.3 系列聚合缺少完整 token 回执");
    const card = buildSeriesCard({
      seriesKey: input.seriesKey,
      raw: gateway.raw,
      cards,
      snapshotSha256: staged.snapshot.snapshotSha256,
      usage,
    });
    const body = Buffer.from(`${JSON.stringify(card, null, 2)}\n`, "utf8");
    const historyName = `manhua-template-learn/proposals-history/${card.id}/${cards.length}-${staged.snapshot.snapshotSha256.slice(0, 16)}.json`;
    await lease.assertOwnedForCommit();
    await deps.create({
      objectName: historyName,
      buffer: body,
      contentType: "application/json",
    });
    // 历史写入也是一次网络往返；正式对象覆盖前同时验租约和全部分集代际。
    await lease.assertOwnedForCommit();
    await assertNativeSeriesSnapshotCurrent(input.seriesKey, staged.snapshot, deps);
    // 全量代际核对本身也有网络延迟，覆盖前最后再验一次锁。
    await lease.assertOwnedForCommit();
    const objectName = nativeSeriesProposalObjectName(input.seriesKey);
    const uploaded = await deps.upload({ objectName, buffer: body, contentType: "application/json" });
    return {
      card,
      gcsUri: uploaded.gcsUri,
      objectName,
      sourceEpisodeCount: cards.length,
      snapshotSha256: staged.snapshot.snapshotSha256,
      reused: false,
      usage,
    };
  } catch (error) {
    const wrapped = (error instanceof Error ? error : new Error(String(error))) as NativeSeriesAggregationError;
    const gatewayUsage = (wrapped as AggregateGatewayError).aggregateGatewayUsage;
    if (!observedUsage && gatewayUsage) {
      observedUsage = {
        model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
        route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
        inputTokens: gatewayUsage.inputTokens,
        outputTokens: gatewayUsage.outputTokens,
        reasoningTokens: gatewayUsage.reasoningTokens,
        costUsd: gatewayUsage.costUsd,
        priceEquivalentCny: gatewayUsage.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT,
        usingPlanQuota: false,
        receiptComplete: gatewayUsage.inputTokens > 0 && gatewayUsage.outputTokens > 0,
      };
    }
    if (observedUsage) wrapped.nativeSeriesAggregationUsage = observedUsage;
    throw wrapped;
  } finally {
    await rm(staged.snapshot.dir, { recursive: true, force: true });
    if (lease) {
      await lease.release().catch((error) => {
        console.warn("[nativeSeriesAggregation] 聚合已结束，锁清理待租约过期：", error instanceof Error ? error.message : error);
      });
    }
  }
}
