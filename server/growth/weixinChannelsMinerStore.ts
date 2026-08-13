import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import { WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS, WEIXIN_CHANNELS_PROBE_TARGET } from "@shared/weixinChannelsRules";
import { mergeTrendCollections, readTrendStore } from "./trendStore";
import {
  WEIXIN_CHANNELS_ACCUMULATION_TARGET,
  buildWeixinChannelsCandidateQueue,
  buildWeixinChannelsTrendCollection,
  cleanWeixinChannelsObservationsLocally,
  invokeWeixinChannelsTerraDirect,
  persistableWeixinChannelsObservation,
  selectWeixinChannelsTerraInput,
  type FinalAnalysisJob,
  type LunaBatch,
  type PersistedWeixinChannelsObservation,
  type WeixinChannelsCandidate,
  type WeixinChannelsObservation,
} from "./weixinChannelsMiner";

type CandidateState = WeixinChannelsCandidate & {
  status: "pending" | "claimed" | "scanned";
  updatedAt: string;
  claimedBy?: string;
  claimExpiresAt?: string;
};

export type WeixinChannelsMinerState = {
  version: 2;
  updatedAt: string;
  capture: {
    enabled: boolean;
    updatedAt: string;
    lastHeartbeatAt?: string;
    lastClientId?: string;
  };
  aggregationPaused: boolean;
  candidates: CandidateState[];
  observations: PersistedWeixinChannelsObservation[];
  lunaBatches: LunaBatch[];
  jobs: FinalAnalysisJob[];
};

const DEFAULT_STORE_ROOT = path.resolve(process.cwd(), ".cache");
let mutationQueue: Promise<unknown> = Promise.resolve();
let backgroundWorker: Promise<void> | null = null;

function storeFile() {
  const dir = path.resolve(process.env.GROWTH_STORE_DIR || path.join(DEFAULT_STORE_ROOT, "growth"));
  return path.resolve(process.env.WEIXIN_CHANNELS_MINER_STORE_FILE || path.join(dir, "weixin-channels-miner.json"));
}

function emptyState(): WeixinChannelsMinerState {
  const now = new Date().toISOString();
  return {
    version: 2,
    updatedAt: now,
    capture: { enabled: false, updatedAt: now },
    aggregationPaused: false,
    candidates: [],
    observations: [],
    lunaBatches: [],
    jobs: [],
  };
}

function migrateState(parsed: Record<string, unknown>): WeixinChannelsMinerState {
  const base = emptyState();
  const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates as CandidateState[] : [];
  const rawObservations = Array.isArray(parsed.observations) ? parsed.observations as WeixinChannelsObservation[] : [];
  return {
    version: 2,
    updatedAt: String(parsed.updatedAt || base.updatedAt),
    capture: parsed.capture && typeof parsed.capture === "object"
      ? { ...base.capture, ...(parsed.capture as WeixinChannelsMinerState["capture"]) }
      : base.capture,
    aggregationPaused: Boolean(parsed.aggregationPaused),
    candidates: rawCandidates.map((item) => ({
      ...item,
      status: item.status === "claimed" || item.status === "scanned" ? item.status : "pending",
      updatedAt: item.updatedAt || item.createdAt || base.updatedAt,
    })),
    observations: rawObservations.map((item) => persistableWeixinChannelsObservation(item)),
    lunaBatches: Array.isArray(parsed.lunaBatches) ? parsed.lunaBatches as LunaBatch[] : [],
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs as FinalAnalysisJob[] : [],
  };
}

async function readState(): Promise<WeixinChannelsMinerState> {
  try {
    return migrateState(JSON.parse(await fs.readFile(storeFile(), "utf8")) as Record<string, unknown>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state: WeixinChannelsMinerState) {
  const file = storeFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = { ...state, version: 2 as const, updatedAt: new Date().toISOString() };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(temp, file);
  return next;
}

function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(work, work);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function formalAvailable(state: WeixinChannelsMinerState) {
  return state.observations.filter((item) => item.runKind !== "probe" && item.qualified && !item.invalid && !item.consumedAt && !item.aggregationJobId);
}

function createJob(
  state: WeixinChannelsMinerState,
  kind: "formal" | "probe",
  source: PersistedWeixinChannelsObservation[],
): WeixinChannelsMinerState {
  const now = new Date().toISOString();
  const jobId = `wxc_${kind}_${now.replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const cleaned = cleanWeixinChannelsObservationsLocally(source);
  const selected = kind === "formal"
    ? selectWeixinChannelsTerraInput(cleaned.kept).selected
    : cleaned.kept;
  if (kind === "formal" && selected.length < WEIXIN_CHANNELS_ACCUMULATION_TARGET) {
    return state;
  }
  const selectedIds = new Set(selected.map((item) => item.observationId));
  const removedIds = new Set(cleaned.removed.map((item) => item.observationId));
  const claimedSource = source.filter((item) => selectedIds.has(item.observationId) || removedIds.has(item.observationId));
  const job: FinalAnalysisJob = {
    jobId,
    kind,
    threshold: kind === "formal" ? WEIXIN_CHANNELS_ACCUMULATION_TARGET : WEIXIN_CHANNELS_PROBE_TARGET,
    rawCount: claimedSource.length,
    locallyDedupedCount: selected.length,
    observationIds: claimedSource.map((item) => item.observationId),
    analysisObservationIds: selected.map((item) => item.observationId),
    // 旧字段保留给已落盘状态迁移；新任务不再创建 Luna 批次。
    lunaBatchIds: [],
    status: "pending",
    terraModel: "gpt-5.6-terra",
    reasoningEffort: "high",
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    observations: kind === "formal"
      ? state.observations.map((item) => job.observationIds.includes(item.observationId) ? { ...item, aggregationJobId: jobId } : item)
      : state.observations,
    jobs: [...state.jobs, job],
  };
}

function maybeCreateFormalJob(state: WeixinChannelsMinerState) {
  const active = state.jobs.some((job) => job.kind === "formal" && job.status !== "completed");
  if (active) return state;
  const available = formalAvailable(state);
  if (available.length < WEIXIN_CHANNELS_ACCUMULATION_TARGET) return state;
  return createJob(state, "formal", available.slice(0, WEIXIN_CHANNELS_AGGREGATION_MAX_ITEMS));
}

export async function refreshWeixinChannelsCandidates(options?: { perPlatform?: number; windowDays?: number }) {
  return serializeMutation(async () => {
    const state = await readState();
    const trends = await readTrendStore({ preferDerivedFiles: true });
    const generated = buildWeixinChannelsCandidateQueue(trends.collections, options);
    const currentById = new Map(state.candidates.map((item) => [item.taskId, item]));
    const newIds = new Set(generated.map((item) => item.taskId));
    const candidates: CandidateState[] = generated.map((candidate) => {
      const current = currentById.get(candidate.taskId);
      return current ? { ...candidate, status: current.status, updatedAt: current.updatedAt, claimedBy: current.claimedBy, claimExpiresAt: current.claimExpiresAt } : {
        ...candidate,
        status: "pending",
        updatedAt: candidate.createdAt,
      };
    });
    for (const current of state.candidates) {
      if (!newIds.has(current.taskId) && (current.status !== "pending" || state.observations.some((item) => item.taskId === current.taskId))) {
        candidates.push(current);
      }
    }
    return writeState({ ...state, candidates });
  });
}

export async function getWeixinChannelsMinerState() {
  await mutationQueue;
  return readState();
}

function mergeObservation(
  current: PersistedWeixinChannelsObservation | undefined,
  incoming: PersistedWeixinChannelsObservation,
) {
  if (!current) return incoming;
  const max = (left?: number, right?: number) => Math.max(left || 0, right || 0) || undefined;
  const comments = [...(current.commentSamples || []), ...(incoming.commentSamples || [])];
  const seen = new Set<string>();
  return persistableWeixinChannelsObservation({
    ...current,
    ...incoming,
    likes: max(current.likes, incoming.likes),
    shares: max(current.shares, incoming.shares),
    favorites: max(current.favorites, incoming.favorites),
    comments: max(current.comments, incoming.comments),
    views: max(current.views, incoming.views),
    commentSamples: comments.filter((sample) => {
      const key = `${sample.author || ""}:${sample.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20),
    aggregationJobId: current.aggregationJobId,
    consumedAt: current.consumedAt,
    growthMergedAt: current.growthMergedAt,
  });
}

export async function ingestWeixinChannelsObservations(params: {
  taskId: string;
  observations: WeixinChannelsObservation[];
}) {
  return serializeMutation(async () => {
    let state = await readState();
    const candidate = state.candidates.find((item) => item.taskId === params.taskId);
    if (!candidate) throw new Error("weixin_channels_candidate_not_found");
    if (params.observations.some((item) => item.taskId !== params.taskId)) {
      throw new Error("weixin_channels_observation_task_mismatch");
    }
    const currentById = new Map(state.observations.map((item) => [item.observationId, item]));
    const results = params.observations.map((raw) => {
      const incoming = persistableWeixinChannelsObservation(raw);
      if (incoming.comments !== undefined && incoming.comments >= 80 && !incoming.invalid && !incoming.commentSamples?.length) {
        throw new Error("weixin_channels_comments_required");
      }
      const merged = mergeObservation(currentById.get(raw.observationId), incoming);
      currentById.set(raw.observationId, merged);
      return merged;
    });
    state = {
      ...state,
      observations: Array.from(currentById.values()),
      candidates: state.candidates.map((item) => item.taskId === params.taskId
        ? { ...item, status: "scanned", claimedBy: undefined, claimExpiresAt: undefined, updatedAt: new Date().toISOString() }
        : item),
    };
    state = maybeCreateFormalJob(state);
    state = await writeState(state);

    const qualifiedForGrowth = results.filter((item) => item.qualified && !item.invalid && !item.growthMergedAt);
    let growthMerged = qualifiedForGrowth.length === 0;
    if (qualifiedForGrowth.length) {
      try {
        await mergeTrendCollections({
          weixin_channels: buildWeixinChannelsTrendCollection({
            observations: qualifiedForGrowth,
            candidateByTaskId: new Map(state.candidates.map((item) => [item.taskId, item])),
          }),
        });
        const mergedAt = new Date().toISOString();
        const ids = new Set(qualifiedForGrowth.map((item) => item.observationId));
        state = await writeState({
          ...state,
          observations: state.observations.map((item) => ids.has(item.observationId) ? { ...item, growthMergedAt: mergedAt } : item),
        });
        growthMerged = true;
      } catch (error) {
        console.error("[weixin-channels] raw persisted but trend merge failed", error);
      }
    }

    const accumulatedQualifiedCount = formalAvailable(state).length;
    const aggregationJob = state.jobs.find((job) => job.kind === "formal" && job.status !== "completed");
    const first = results[0];
    return {
      persisted: true as const,
      scanned: true as const,
      qualified: first?.qualified ?? false,
      invalid: first?.invalid ?? false,
      qualificationReason: first?.qualificationReason || "",
      modelCalls: 0 as const,
      accumulatedQualifiedCount,
      aggregationQueued: Boolean(aggregationJob),
      aggregationJobId: aggregationJob?.jobId,
      growthMerged,
      results: results.map((item) => ({
        observationId: item.observationId,
        scanned: true as const,
        qualified: item.qualified,
        invalid: item.invalid,
        qualificationReason: item.qualificationReason,
        modelCalls: 0 as const,
      })),
    };
  });
}

export async function setWeixinChannelsCaptureEnabled(enabled: boolean) {
  return serializeMutation(async () => {
    const state = await readState();
    return writeState({
      ...state,
      capture: { ...state.capture, enabled, updatedAt: new Date().toISOString() },
    });
  });
}

/** 仅给明确授权的 probe CLI 建立幂等任务入口；正式候选仍来自真实跨平台热榜。 */
export async function ensureWeixinChannelsProbeCandidate(params: { taskId: string; queries: string[] }) {
  return serializeMutation(async () => {
    const state = await readState();
    const existing = state.candidates.find((item) => item.taskId === params.taskId);
    if (existing) return { state, candidate: existing };
    const now = new Date().toISOString();
    const candidate: CandidateState = {
      taskId: params.taskId,
      sourcePlatform: "douyin",
      sourceItemId: `probe:${params.taskId}`,
      sourceTitle: params.queries.join(" / ").slice(0, 500),
      category: "probe/test-run",
      sourceGrowthScore: 0,
      sourceGrowthPercentile: 0,
      sourceMetrics: {},
      searchQueries: Array.from(new Set(params.queries)).slice(0, 20),
      createdAt: now,
      status: "pending",
      updatedAt: now,
    };
    const next = await writeState({ ...state, candidates: [...state.candidates, candidate] });
    return { state: next, candidate };
  });
}

export async function recordWeixinChannelsHeartbeat(clientId: string) {
  return serializeMutation(async () => {
    let state = await readState();
    const now = new Date();
    const nowIso = now.toISOString();
    const claimExpiry = new Date(now.getTime() + 5 * 60_000).toISOString();
    let nextTask: CandidateState | undefined;
    if (state.capture.enabled) {
      nextTask = state.candidates.find((item) =>
        item.status === "pending" || (item.status === "claimed" && (!item.claimExpiresAt || item.claimExpiresAt <= nowIso)),
      );
      if (nextTask) {
        state = {
          ...state,
          candidates: state.candidates.map((item) => item.taskId === nextTask?.taskId
            ? { ...item, status: "claimed", claimedBy: clientId, claimExpiresAt: claimExpiry, updatedAt: nowIso }
            : item),
        };
        nextTask = state.candidates.find((item) => item.taskId === nextTask?.taskId);
      }
    }
    state = await writeState({
      ...state,
      capture: { ...state.capture, lastHeartbeatAt: nowIso, lastClientId: clientId },
    });
    return { enabled: state.capture.enabled, nextTask, serverTime: nowIso };
  });
}

export async function setWeixinChannelsAggregationPaused(paused: boolean) {
  return serializeMutation(async () => {
    const state = await readState();
    return writeState({
      ...state,
      aggregationPaused: paused,
      jobs: state.jobs.map((job) => job.status === "processing" && paused
        ? { ...job, status: "paused", claimToken: undefined, updatedAt: new Date().toISOString() }
        : job),
    });
  });
}

export async function createWeixinChannelsProbeJob() {
  return serializeMutation(async () => {
    let state = await readState();
    const source = state.observations.filter((item) => item.runKind === "probe" && item.qualified && !item.invalid).slice(-WEIXIN_CHANNELS_PROBE_TARGET);
    if (source.length < WEIXIN_CHANNELS_PROBE_TARGET) throw new Error("weixin_channels_probe_requires_5_qualified_records");
    const sourceIds = source.map((item) => item.observationId).sort();
    const existing = state.jobs.find((job) => job.kind === "probe"
      && job.observationIds.length === sourceIds.length
      && [...job.observationIds].sort().every((id, index) => id === sourceIds[index]));
    if (existing) return { state, job: existing };
    const active = state.jobs.find((job) => job.kind === "probe" && job.status !== "completed");
    if (active) return { state, job: active };
    state = createJob(state, "probe", source);
    state = await writeState(state);
    return { state, job: state.jobs[state.jobs.length - 1]! };
  });
}

export async function processWeixinChannelsAggregationJob(
  jobId?: string,
  options?: { invoke?: NonNullable<Parameters<typeof invokeWeixinChannelsTerraDirect>[0]["invoke"]>; staleClaimMs?: number },
) {
  const claimToken = randomUUID();
  let claimed = await serializeMutation(async () => {
    const state = await readState();
    if (state.aggregationPaused) throw new Error("weixin_channels_aggregation_paused");
    const job = jobId
      ? state.jobs.find((item) => item.jobId === jobId)
      : state.jobs.find((item) => item.status === "pending" || item.status === "failed" || item.status === "paused");
    if (!job) throw new Error("weixin_channels_aggregation_job_not_found");
    if (job.status === "completed") return { state, job };
    const claimAge = Date.now() - Date.parse(job.updatedAt);
    if (job.status === "processing" && job.claimToken && claimAge < (options?.staleClaimMs ?? 15 * 60_000)) {
      throw new Error("weixin_channels_aggregation_already_claimed");
    }
    const next = await writeState({
      ...state,
      jobs: state.jobs.map((item) => item.jobId === job.jobId
        ? { ...item, status: "processing", claimToken, error: undefined, updatedAt: new Date().toISOString() }
        : item),
      lunaBatches: state.lunaBatches.map((batch) => batch.jobId === job.jobId && batch.status === "running"
        ? { ...batch, status: "failed", error: "进程中断后恢复", updatedAt: new Date().toISOString() }
        : batch),
    });
    return { state: next, job: next.jobs.find((item) => item.jobId === job.jobId)! };
  });
  if (claimed.job.status === "completed") return claimed.job;

  const targetJobId = claimed.job.jobId;
  try {
    const beforeFinal = await getWeixinChannelsMinerState();
    const job = beforeFinal.jobs.find((item) => item.jobId === targetJobId)!;
    if (beforeFinal.aggregationPaused) throw new Error("weixin_channels_aggregation_paused");
    const analysisIds = new Set(job.analysisObservationIds || job.observationIds);
    const source = beforeFinal.observations.filter((item) => analysisIds.has(item.observationId));
    const observations = cleanWeixinChannelsObservationsLocally(source).kept;
    if (!observations.length) throw new Error("weixin_channels_terra_direct_input_empty");
    const final = job.finalResult
      ? { result: job.finalResult, provider: job.terraProvider || "evolink" as const, usage: job.usage || {} }
      : await invokeWeixinChannelsTerraDirect({
          job,
          observations,
          invoke: options?.invoke,
        });
    claimed = await serializeMutation(async () => {
      const state = await readState();
      const completedAt = new Date().toISOString();
      const current = state.jobs.find((item) => item.jobId === targetJobId);
      if (current?.claimToken !== claimToken) throw new Error("weixin_channels_aggregation_claim_lost");
      let next: WeixinChannelsMinerState = {
        ...state,
        jobs: state.jobs.map((item) => item.jobId === targetJobId ? {
          ...item,
          status: "completed",
          claimToken: undefined,
          terraProvider: final.provider,
          finalResult: final.result,
          usage: final.usage,
          error: undefined,
          completedAt,
          updatedAt: completedAt,
        } : item),
        observations: current?.kind === "formal"
          ? state.observations.map((item) => current.observationIds.includes(item.observationId) ? { ...item, consumedAt: completedAt } : item)
          : state.observations,
      };
      next = maybeCreateFormalJob(next);
      next = await writeState(next);
      return { state: next, job: next.jobs.find((item) => item.jobId === targetJobId)! };
    });
    return claimed.job;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await serializeMutation(async () => {
      const state = await readState();
      await writeState({
        ...state,
        jobs: state.jobs.map((item) => item.jobId === targetJobId && item.status !== "paused"
          ? { ...item, status: "failed", claimToken: undefined, error: message, updatedAt: new Date().toISOString() }
          : item),
        lunaBatches: state.lunaBatches.map((item) => item.jobId === targetJobId && item.status === "running"
          ? { ...item, status: "failed", error: message, updatedAt: new Date().toISOString() }
          : item),
      });
    });
    throw error;
  }
}

export function startWeixinChannelsAggregationInBackground(jobId?: string) {
  if (backgroundWorker) return false;
  backgroundWorker = processWeixinChannelsAggregationJob(jobId)
    .then(() => undefined)
    .catch((error) => console.error("[weixin-channels] aggregation failed", error))
    .finally(() => { backgroundWorker = null; });
  return true;
}

export function summarizeCandidateSources(candidates: WeixinChannelsCandidate[]) {
  return candidates.reduce<Partial<Record<GrowthPlatform, number>>>((acc, item) => {
    acc[item.sourcePlatform] = (acc[item.sourcePlatform] || 0) + 1;
    return acc;
  }, {});
}
