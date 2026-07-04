import { withFlyHealthGate } from "@/lib/flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";

export type JobType = "video" | "image" | "audio";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobResponse = {
  status: JobStatus;
  output?: Record<string, any>;
  error?: string;
};

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
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Failed to create job (${response.status})`);
  }

  return response.json() as Promise<{ jobId: string }>;
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const url = withLongJobsFlyDirect(`/api/jobs/${encodeURIComponent(jobId)}`);
  const response = await withFlyHealthGate(flyHealthProbeOriginForUrl(url), () =>
    fetch(url, {
      method: "GET",
      credentials: "include",
    }),
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Failed to fetch job (${response.status})`);
  }

  return response.json() as Promise<JobResponse>;
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
    return code === 429 || code === 502 || code === 503 || code === 504;
  }
  if (/\b502\b|\b503\b|\b504\b|\b429\b/.test(m)) {
    return true;
  }
  return (
    /^Failed to fetch$/i.test(m.trim()) ||
    /NetworkError|network error|Load failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(m)
  );
}

/**
 * 供轮询使用：对单次 GET 做有限次退避重试（不 increment poll attempt，由 pollJobUntilTerminal 外层计数）
 */
export async function getJobForPoll(jobId: string): Promise<JobResponse> {
  const maxAttempts = 6;
  let lastErr: Error | undefined;
  for (let a = 1; a <= maxAttempts; a++) {
    try {
      return await getJob(jobId);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
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

