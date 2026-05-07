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
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Failed to create job (${response.status})`);
  }

  return response.json() as Promise<{ jobId: string }>;
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Failed to fetch job (${response.status})`);
  }

  return response.json() as Promise<JobResponse>;
}

/** 單次 GET /api/jobs/:id 後回調（含第幾次、當前狀態、耗時） */
export type PollJobTick = {
  jobId: string;
  attempt: number;
  status: JobStatus;
  elapsedMs: number;
};

const MAX_POLL_DEBUG_LINES = 120;

/** Fly jobs 隊列（含 platform 文案 / 封面生圖）：輪詢直到終態 */
export async function pollJobUntilTerminal(
  jobId: string,
  opts?: {
    intervalMs?: number;
    maxWaitMs?: number;
    /** 每次拉取 job 後觸發（含尚未進入終態的中間狀態） */
    onPoll?: (tick: PollJobTick) => void;
  },
): Promise<JobResponse> {
  const interval = opts?.intervalMs ?? 2500;
  const maxWait = opts?.maxWaitMs ?? 14 * 60_000;
  const t0 = Date.now();
  let attempt = 0;
  while (Date.now() - t0 < maxWait) {
    attempt += 1;
    const j = await getJob(jobId);
    opts?.onPoll?.({
      jobId,
      attempt,
      status: j.status,
      elapsedMs: Date.now() - t0,
    });
    if (j.status === "succeeded" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("任務輪詢超時，請刷新頁面或稍後再試");
}

/** 將輪詢步驟追加到陣列並截斷長度，避免 Debug 面板無限變長 */
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

