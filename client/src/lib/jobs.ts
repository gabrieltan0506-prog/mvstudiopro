import { withFlyHealthGate } from "@/lib/flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";

export type JobType = "video" | "image" | "audio";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobResponse = {
  status: JobStatus;
  output?: Record<string, any>;
  error?: string;
};

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

export async function createJob(payload: {
  type: JobType;
  userId: string;
  input: Record<string, unknown>;
}): Promise<{ jobId: string }> {
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
    throw new Error(await formatCreateJobError(response));
  }

  return response.json() as Promise<{ jobId: string }>;
}

async function formatCreateJobError(response: Response): Promise<string> {
  const detail = await response.text().catch(() => "");
  let message = detail || `Failed to create job (${response.status})`;
  try {
    const parsed = JSON.parse(detail) as { error?: string };
    if (parsed?.error === "Invalid job type") {
      message = "任务类型无效，请刷新后重试";
    } else if (typeof parsed?.error === "string" && parsed.error.trim()) {
      message = parsed.error;
    }
  } catch {
    /* keep raw */
  }
  return message;
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
export async function pollJobUntilTerminal(
  jobId: string,
  opts?: {
    intervalMs?: number;
    maxWaitMs?: number;
    /**
     * 自第几次轮询起拉长间隔（预设 36 ≈ 首段约 1.5min×2.5s），避免长任务下 GET 过于密集、计数暴涨。
     */
    adaptiveBackoffAfterAttempts?: number;
    /** 拉长后的间隔上限（预设 8s） */
    maxIntervalMs?: number;
    /** 每次拉取 job 后触发（含尚未进入终态的中间状态） */
    onPoll?: (tick: PollJobTick) => void;
  },
): Promise<JobResponse> {
  const interval = opts?.intervalMs ?? 2500;
  const maxWait = opts?.maxWaitMs ?? 14 * 60_000;
  const adaptiveAfter = opts?.adaptiveBackoffAfterAttempts ?? 36;
  const maxInterval = opts?.maxIntervalMs ?? 8000;
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
    const spacing =
      attempt >= adaptiveAfter ? Math.min(maxInterval, interval * 2) : interval;
    await sleep(spacing);
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
