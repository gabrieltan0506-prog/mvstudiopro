import { withFlyHealthGate } from "@/lib/flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { MANHUA_NATIVE_DEEP_READ_ACTIVE_PARAMS_CONFLICT_CODE } from "@shared/manhuaNativeDeepReadJob";

export type JobType = "video" | "image" | "audio";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobResponse = {
  status: JobStatus;
  output?: Record<string, any>;
  error?: string;
};

export class CreateJobError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CreateJobError";
    this.status = status;
    this.code = code;
  }
}

export function isManhuaNativeDeepReadParamsConflict(error: unknown): error is CreateJobError {
  return error instanceof CreateJobError
    && error.status === 409
    && error.code === MANHUA_NATIVE_DEEP_READ_ACTIVE_PARAMS_CONFLICT_CODE;
}

export type ManhuaLearnServerJob = {
  jobId: string;
  status: JobStatus;
  input?: {
    action?: string;
    params?: Record<string, unknown>;
  };
  output?: Record<string, unknown>;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function listManhuaLearnServerJobs(): Promise<{ maxConcurrent: number; items: ManhuaLearnServerJob[] }> {
  const response = await fetch("/api/jobs/manhua-learn", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await formatCreateJobError(response));
  const parsed = await response.json() as {
    maxConcurrent?: unknown;
    items?: unknown;
  };
  return {
    maxConcurrent: Math.max(1, Math.min(2, Number(parsed.maxConcurrent) || 2)),
    items: Array.isArray(parsed.items) ? parsed.items as ManhuaLearnServerJob[] : [],
  };
}

async function controlManhuaLearnJob(
  jobId: string,
  action: "cancel" | "skip",
): Promise<{ jobId: string; status: JobStatus; messageZh?: string }> {
  const response = await fetch(
    `/api/jobs/manhua-learn/${encodeURIComponent(jobId)}/${action}`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) throw new Error(await formatCreateJobError(response));
  return response.json();
}

export function cancelManhuaLearnServerJob(jobId: string) {
  return controlManhuaLearnJob(jobId, "cancel");
}

export function skipManhuaLearnServerEpisode(jobId: string) {
  return controlManhuaLearnJob(jobId, "skip");
}

export async function hideManhuaLearnServerSeries(jobId: string) {
  const response = await fetch(
    `/api/jobs/manhua-learn/${encodeURIComponent(jobId)}/hide`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) throw new Error(await formatCreateJobError(response));
  return response.json() as Promise<{ hiddenCount: number; hiddenJobIds: string[]; messageZh?: string }>;
}

export async function clearOtherManhuaLearnSeries(keepJobId: string) {
  const response = await fetch(
    `/api/jobs/manhua-learn/${encodeURIComponent(keepJobId)}/clear-others`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) throw new Error(await formatCreateJobError(response));
  return response.json() as Promise<{ removedJobIds: string[]; keptJobIds: string[]; messageZh?: string }>;
}

export async function createJob(payload: {
  type: JobType;
  userId: string;
  input: Record<string, unknown>;
}): Promise<{
  jobId: string;
  status?: JobStatus;
  reused?: boolean;
  reuseMatch?: "native_confirmation" | "source_only";
}> {
  const url = withLongJobsFlyDirect("/api/jobs");
  const response = await withFlyHealthGate(flyHealthProbeOriginForUrl(url), () =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    }),
  );

  if (!response.ok) {
    const detail = await parseCreateJobError(response);
    throw new CreateJobError(detail.message, response.status, detail.code);
  }

  return response.json() as Promise<{
    jobId: string;
    status?: JobStatus;
    reused?: boolean;
    reuseMatch?: "native_confirmation" | "source_only";
  }>;
}

async function formatCreateJobError(response: Response): Promise<string> {
  return (await parseCreateJobError(response)).message;
}

async function parseCreateJobError(response: Response): Promise<{ message: string; code?: string }> {
  const detail = await response.text().catch(() => "");
  let message = detail || `Failed to create job (${response.status})`;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(detail) as { error?: string; code?: string };
    if (typeof parsed?.code === "string" && parsed.code.trim()) code = parsed.code.trim();
    if (parsed?.error === "Invalid job type") {
      message = "任务类型无效，请刷新后重试";
    } else if (typeof parsed?.error === "string" && parsed.error.trim()) {
      message = parsed.error;
    }
  } catch {
    /* keep raw */
  }
  return { message, code };
}

/**
 * 同源入队（www → Vercel rewrite → Fly）：适合「短创建 + 轮询」任务，避免长任务直连 api 子域。
 */
export async function createJobSameOrigin(payload: {
  type: JobType;
  userId: string;
  input: Record<string, unknown>;
}): Promise<{ jobId: string }> {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await formatCreateJobError(response));
  }
  return response.json() as Promise<{ jobId: string }>;
}

function jobApiPath(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}`;
}

/** 跨域直连 Fly/api 子域时 Session Cookie 可能丢失；轮询改走同源（Vercel rewrite → Fly）。 */
function resolveJobPollUrl(jobId: string): string {
  const path = jobApiPath(jobId);
  const directUrl = withLongJobsFlyDirect(path);
  if (typeof window === "undefined") return directUrl;
  try {
    const resolved = directUrl.startsWith("http")
      ? directUrl
      : `${window.location.origin}${directUrl.startsWith("/") ? directUrl : `/${directUrl}`}`;
    if (new URL(resolved).origin !== window.location.origin) {
      return path;
    }
  } catch {
    /* keep direct */
  }
  return directUrl;
}

function formatJobFetchError(status: number, detail: string): Error {
  if (status === 401) {
    // 带上 (401) 前缀，轮询层才能识别并做有限次重试；文案仍是给用户看的那句
    return new Error(
      "(401) 登录状态已失效，无法查询分析进度。请刷新页面重新登录后再试（后台任务可能仍在运行）",
    );
  }
  // 始终带 (statusCode) 前缀，让 isTransientJobPollError 能正确分类（404 按瞬态处理）
  return new Error(`(${status}) ${detail || "Failed to fetch job"}`);
}

async function fetchJob(url: string): Promise<JobResponse> {
  const response = await withFlyHealthGate(flyHealthProbeOriginForUrl(url), () =>
    fetch(url, {
      method: "GET",
      credentials: "include",
    }),
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw formatJobFetchError(response.status, detail);
  }

  return response.json() as Promise<JobResponse>;
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const path = jobApiPath(jobId);
  const pollUrl = resolveJobPollUrl(jobId);
  try {
    return await fetchJob(pollUrl);
  } catch (error) {
    // 同源 404 时回退直连（Job 可能刚写入 Fly、尚未经 rewrite 可见）
    const directUrl = withLongJobsFlyDirect(path);
    const is404 =
      error instanceof Error &&
      (/\(404\)/.test(error.message) || /Job not found/i.test(error.message));
    if (is404 && pollUrl !== directUrl) {
      return fetchJob(directUrl);
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 闸道 502、上游抖动、浏览器层网路失败：轮询时应退避重试，避免误判任务失败 */
function isTransientJobPollError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  const paren = m.match(/\((\d{3})\)/);
  if (paren) {
    const code = Number(paren[1]);
    // 404：Job 尚未写入 DB（DB 写入竞争/延迟），按瞬态处理，最多重试 3 次
    return code === 404 || code === 429 || code === 502 || code === 503 || code === 504;
  }
  if (/\b502\b|\b503\b|\b504\b|\b429\b/.test(m)) {
    return true;
  }
  return (
    /^Failed to fetch$/i.test(m.trim()) ||
    /NetworkError|network error|Load failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(m)
  );
}

/** 404「Job not found」：DB 写入和首次轮询存在竞态，3 次内重试 */
const MAX_404_RETRIES = 3;

/**
 * 401 也可能是假的：服务端鉴权要读一次用户表，库抖一下就回 401。
 * 一次 401 就把最长 95 分钟的任务判死太脆，连续 3 次才认定登录真失效。
 */
const MAX_401_RETRIES = 3;

/**
 * 供轮询使用：对单次 GET 做有限次退避重试（不 increment poll attempt，由 pollJobUntilTerminal 外层计数）
 */
export async function getJobForPoll(jobId: string): Promise<JobResponse> {
  const maxAttempts = 6;
  let notFoundRetries = 0;
  let unauthorizedRetries = 0;
  let lastErr: Error | undefined;
  for (let a = 1; a <= maxAttempts; a++) {
    try {
      return await getJob(jobId);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (/\(401\)/.test(lastErr.message)) {
        unauthorizedRetries += 1;
        if (unauthorizedRetries < MAX_401_RETRIES) {
          // 401 重试时间: 1s, 2s
          await sleep(1000 * 2 ** (unauthorizedRetries - 1));
          continue;
        }
        // 连续 3 次仍 401：认定登录确实失效，抛去掉状态码前缀的人话
        throw new Error(lastErr.message.replace(/^\(401\)\s*/, ""));
      }
      const is404 = /\(404\)/.test(lastErr.message) || /Job not found/i.test(lastErr.message);
      if (is404) {
        notFoundRetries += 1;
        if (notFoundRetries <= MAX_404_RETRIES) {
          // 404 重试时间: 1s, 2s, 4s
          await sleep(Math.min(4000, 1000 * 2 ** (notFoundRetries - 1)));
          continue;
        }
        // 超过 3 次 404 仍未找到，改抛友好错误
        throw new Error("素材分析任务不存在（Job not found），请重新上传素材重试");
      }
      if (!isTransientJobPollError(lastErr) || a === maxAttempts) {
        throw lastErr;
      }
      await sleep(Math.min(4000, 500 * 2 ** (a - 1)));
    }
  }
  throw lastErr ?? new Error("getJobForPoll: unknown error");
}

/** 单次 GET /api/jobs/:id 后回调（含第几次、当前状态、耗时、部分 output） */
export type PollJobTick = {
  jobId: string;
  attempt: number;
  status: JobStatus;
  elapsedMs: number;
  output?: Record<string, unknown>;
};

const MAX_POLL_DEBUG_LINES = 120;

/** Fly jobs 队列（含 platform 文案 / 封面生图）：轮询直到终态 */
/** 页面是否在后台（SSR / 测试环境里当作前台） */
export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * 下一次轮询该等多久（纯函数，便于直接测）。
 *
 * · 前 adaptiveAfter 轮保持起始间隔，保证刚提交时反馈够快；
 * · 之后按 backoffFactor 逐轮递增，直到 maxInterval 封顶——长任务后半程不必每几秒问一次；
 * · 页面切到后台时至少等 hiddenInterval；
 * · 加 ±15% 抖动：多个标签页同时打开时不会挤在同一刻齐发（同步齐发最像攻击流量）。
 */
export function nextPollSpacingMs(params: {
  attempt: number;
  interval: number;
  adaptiveAfter: number;
  maxInterval: number;
  backoffFactor: number;
  hiddenInterval: number;
  hidden: boolean;
  /** 仅测试注入；缺省用 Math.random */
  random?: () => number;
}): number {
  const steps = Math.max(0, params.attempt - params.adaptiveAfter + 1);
  const grown = params.interval * params.backoffFactor ** steps;
  // 上限低于起始间隔是无意义配置：按起始间隔兜底，绝不算出比起始还短的间隔。
  // 这条守在纯函数里，不能只守在调用方——否则直接调用它的地方（如学习列表同步）没有保护。
  const cap = Math.max(params.interval, params.maxInterval);
  let spacing = Math.min(cap, Math.max(params.interval, grown));
  if (params.hidden) spacing = Math.max(spacing, params.hiddenInterval);
  // 首段不抖（审查 P2-2）：抖动会把 2.5s 压到 2.1s，比改前更密，与「前段照旧」不符
  if (spacing <= params.interval) return Math.round(spacing);
  const rand = params.random ?? Math.random;
  // 后台档：以 hiddenInterval 为硬下限、只向上抖 0–30%（审查 P2-B）。
  // 双向抖会把下限打到 51s，与「后台至少一分钟」自相矛盾；完全不抖又会让多标签同相齐发。
  if (params.hidden && spacing <= params.hiddenInterval) {
    return Math.round(params.hiddenInterval * (1 + rand() * 0.3));
  }
  // 前台：先抖再夹（审查 P2-1）——夹完再抖会让上限变成 34.5s
  const jittered = Math.round(spacing * (0.85 + rand() * 0.3));
  // 下限：hidden 时不得低于 hiddenInterval（spacing 已超过它时也一样），否则注释里承诺的
  // 「后台至少 N 秒」在 maxInterval > hiddenInterval 的配置下会被向下抖破（审查 P2-1）
  const floor = params.hidden ? Math.max(params.interval, params.hiddenInterval) : params.interval;
  return Math.max(floor, Math.min(cap, jittered));
}

/**
 * 漫剧学习任务列表（`/api/jobs/manhua-learn`）的同步间隔。
 *
 * 0912 事故的真凶就是这条：它不走 pollJobUntilTerminal，而是自己定时硬轮，
 * 活跃时 3 秒、空闲时 15 秒，都是恒定值。它是 Vercel 防火墙 Top Request Paths 的第一名
 * （一天 1.7k、比第二名高近二十倍），最终触发自动 DDoS 缓解、整站发 JS 质询。
 *
 * 现在按档位退避：
 * · 活跃档：3 秒起，20 轮后逐步拉长，30 秒封顶；后台至少 60 秒。
 * · 空闲档：15 秒起，4 轮后逐步拉长，60 秒封顶；后台至少 120 秒。
 *   （面板开着不关一天，旧的恒定 15 秒就是 5760 次——量级上它才是大头。）
 *
 * 轮次与换档由 `nextManhuaLearnSyncState` 决定：**请求失败不清零**，沿用上一档继续退避；
 * 只有「成功且档位真的变了」才从 1 重新计。新任务入队后由调用方调 kick 立即唤醒，
 * 不靠等满空闲档那一轮。
 */
export type ManhuaLearnSyncRegime = "active" | "idle";

export function manhuaLearnSyncDelayMs(params: {
  /** 当前档位内的轮次（换档时从 1 重新计） */
  attempt: number;
  regime: ManhuaLearnSyncRegime;
  hidden: boolean;
  random?: () => number;
}): number {
  // 空闲档同样要退避（审查 P1-C）。它打的是同一个接口，而且面板开着不关就一直打：
  // 旧的恒定 15 秒＝240 次/小时，开七小时就是 1680 次，与防火墙看到的 1.7k 同一量级。
  // 恒定间隔、无抖动、多标签同相位，正是最像机器流量的形状。
  if (params.regime === "idle") {
    return nextPollSpacingMs({
      attempt: params.attempt,
      interval: 15_000,
      adaptiveAfter: 4,
      maxInterval: 60_000,
      backoffFactor: 1.5,
      hiddenInterval: 120_000,
      hidden: params.hidden,
      random: params.random,
    });
  }
  return nextPollSpacingMs({
    attempt: params.attempt,
    interval: 3000,
    adaptiveAfter: 20,
    maxInterval: 30_000,
    backoffFactor: 1.35,
    hiddenInterval: 60_000,
    hidden: params.hidden,
    random: params.random,
  });
}

/**
 * 同步轮次与档位的推进（纯函数，便于直接测——审查 P2-C）。
 *
 * 失败不许清零（审查 P1-B）：被 Vercel 质询时列表接口拿回的是 HTML，`response.json()` 抛错；
 * 若把失败当成「空闲、从头再来」，就会在**正被限流的时候**反而以最密的节奏撞墙。
 * 失败沿用上一档并继续累加轮次，让间隔越拉越长。
 */
export function nextManhuaLearnSyncState(params: {
  attempt: number;
  regime: ManhuaLearnSyncRegime;
  ok: boolean;
  hasActive: boolean;
}): { attempt: number; regime: ManhuaLearnSyncRegime } {
  if (!params.ok) return { attempt: params.attempt + 1, regime: params.regime };
  const regime: ManhuaLearnSyncRegime = params.hasActive ? "active" : "idle";
  if (regime !== params.regime) return { attempt: 1, regime };
  return { attempt: params.attempt + 1, regime };
}

export async function pollJobUntilTerminal(
  jobId: string,
  opts?: {
    intervalMs?: number;
    maxWaitMs?: number;
    /**
     * 自第几次轮询起开始拉长间隔（预设 36 ≈ 首段约 1.5min×2.5s）。
     * 之后每轮按 backoffFactor 递增，直到 maxIntervalMs 封顶。
     */
    adaptiveBackoffAfterAttempts?: number;
    /**
     * 间隔上限（预设 30s）。
     * 0912 事故：漫剧学习任务一跑几小时，固定 2.5s→8s 的两段式轮询一天打出 1.7k 次
     * `/api/jobs/manhua-learn`，成了 Vercel 自动 DDoS 缓解眼里最像机器流量的那一条，
     * 整站被发 JS 质询、接口拿回 HTML，前端报「算力紧张」。
     */
    maxIntervalMs?: number;
    /** 每轮递增倍数（预设 1.35）；1 表示不递增 */
    backoffFactor?: number;
    /**
     * 页面切到后台时的最小间隔。**默认 0（＝不改变既有行为）**。
     *
     * 与 maxIntervalMs 同一口径（审查 P1-1）：全仓 31 个调用点里只有少数评估过，
     * 给它一个非零默认值等于无差别改掉其余所有链路的 hidden 行为。实测危害：
     * `maxWaitMs: 60_000` 的调用点在后台会从约 24 次轮询压到 2 次，重整形等停那条
     * 最坏直接超时抛错、整个流程作废。要压后台流量就在那条链路上显式传。
     */
    hiddenIntervalMs?: number;
    /** 每次拉取 job 后触发（含尚未进入终态的中间状态） */
    onPoll?: (tick: PollJobTick) => void;
  },
): Promise<JobResponse> {
  const interval = opts?.intervalMs ?? 2500;
  const maxWait = opts?.maxWaitMs ?? 14 * 60_000;
  const adaptiveAfter = opts?.adaptiveBackoffAfterAttempts ?? 36;
  // 默认不动（审查 P1-2）：全仓 30 个调用点里只有 8 处显式传值，抬默认等于顺手改掉
  // 二十多个没评估过的出图/看板链路。要压量就在那条链路上显式传 maxIntervalMs。
  const maxInterval = Math.max(interval, opts?.maxIntervalMs ?? 8000);
  const backoffFactor = Math.max(1, opts?.backoffFactor ?? 1.35);
  const hiddenInterval = Math.max(0, opts?.hiddenIntervalMs ?? 0);
  const t0 = Date.now();
  let attempt = 0;
  let lastStatus: JobStatus = "queued";
  while (Date.now() - t0 < maxWait) {
    attempt += 1;
    const j = await getJobForPoll(jobId);
    lastStatus = j.status;
    const out =
      j.output && typeof j.output === "object" && !Array.isArray(j.output)
        ? (j.output as Record<string, unknown>)
        : undefined;
    opts?.onPoll?.({
      jobId,
      attempt,
      status: j.status,
      elapsedMs: Date.now() - t0,
      output: out,
    });
    if (j.status === "succeeded" || j.status === "failed") return j;
    const spacing = nextPollSpacingMs({
      attempt,
      interval,
      adaptiveAfter,
      maxInterval,
      backoffFactor,
      hiddenInterval,
      hidden: isDocumentHidden(),
    });
    /**
     * 审查 P1-1：睡眠必须钳在剩余墙钟预算内。
     * 否则后台标签页里 maxWaitMs=60s 的调用点会「第一次 GET → 睡 60s → 超时」，
     * 只轮一次就报「任务轮询已等待 1 分 0 秒（1 次）」，改前能轮二十多次。
     * 留 250ms 余量，保证到点之前还来得及再查一次。
     */
    const remaining = maxWait - (Date.now() - t0);
    // 预算已经见底：直接收口，不要用 sleep(0) 在最后 250ms 里以 RTT 为周期空转（审查 P2-D）
    if (remaining <= 250) break;
    // 不要再给下限（审查 P2-I）：上面的 break 已保证 remaining-250 > 0，
    // 加 Math.max(interval, …) 反而会睡过 maxWait，把「到点前最后一次补轮」吃掉。
    await sleep(Math.min(spacing, remaining - 250));
  }
  const elapsedSec = Math.max(1, Math.round((Date.now() - t0) / 1000));
  const elapsedMin = Math.floor(elapsedSec / 60);
  const elapsedRemSec = elapsedSec % 60;
  const elapsedLabel =
    elapsedMin > 0 ? `${elapsedMin} 分 ${elapsedRemSec} 秒` : `${elapsedSec} 秒`;
  const queueHint =
    lastStatus === "queued"
      ? "（任务仍在排队，可能队列繁忙）"
      : lastStatus === "running"
        ? "（任务仍在执行中）"
        : "";
  throw new Error(
    `任务轮询已等待 ${elapsedLabel}，状态仍为 ${lastStatus}（${attempt} 次）${queueHint}，请稍后重试或刷新页面`,
  );
}

/** 将轮询步骤追加到阵列并截断长度，避免 Debug 面板无限变长 */
export function appendPollDebugLine(lines: string[], line: string): string[] {
  return [...lines, line].slice(-MAX_POLL_DEBUG_LINES);
}

export const JOB_PROGRESS_MESSAGES: Record<JobType, string[]> = {
  video: [
    "正在排队准备画面引擎...",
    "正在构建镜头与运动轨迹...",
    "正在渲染高质量视频片段...",
    "正在合成最终视频输出...",
  ],
  image: [
    "正在准备画面风格参数...",
    "正在生成构图与光影细节...",
    "正在渲染高分辨率图片...",
    "正在输出最终图像结果...",
  ],
  audio: [
    "正在解析旋律与节奏结构...",
    "正在生成主旋律与编曲层次...",
    "正在混音并优化音色表现...",
    "正在导出最终音频结果...",
  ],
};
