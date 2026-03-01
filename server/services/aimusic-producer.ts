export type ProducerModel = "suno" | "udio";
export type ProducerQuality = "normal" | "high";

type ProducerSong = {
  id: string;
  audioUrl?: string;
  streamUrl?: string;
  downloadUrl?: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  duration?: number;
};

function getJobsApiBase(): string {
  const base = process.env.JOBS_API_BASE_URL || process.env.FRONTEND_URL || "http://127.0.0.1:3000";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function parseTaskId(payload: Record<string, any>): string {
  const candidates = [
    payload.taskId,
    payload.task_id,
    payload.id,
    payload.jobId,
    payload.job_id,
    payload?.data?.taskId,
    payload?.data?.task_id,
    payload?.result?.taskId,
    payload?.result?.task_id,
    payload?.raw?.taskId,
    payload?.raw?.task_id,
    payload?.raw?.data?.taskId,
    payload?.raw?.data?.task_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function normalizeSongs(statusPayload: Record<string, any>): ProducerSong[] {
  const root = asObject(statusPayload.raw ?? statusPayload);
  const list =
    root.songs ||
    root.tracks ||
    root.items ||
    root?.data?.songs ||
    root?.data?.tracks ||
    root?.result?.songs ||
    root?.result?.tracks ||
    [];

  if (!Array.isArray(list)) return [];

  return list.map((song: any, idx: number) => {
    const s = asObject(song);
    return {
      id: String(s.id ?? s.trackId ?? s.track_id ?? idx),
      audioUrl:
        typeof s.audioUrl === "string"
          ? s.audioUrl
          : typeof s.audio_url === "string"
          ? s.audio_url
          : undefined,
      streamUrl:
        typeof s.streamUrl === "string"
          ? s.streamUrl
          : typeof s.stream_url === "string"
          ? s.stream_url
          : undefined,
      downloadUrl:
        typeof s.downloadUrl === "string"
          ? s.downloadUrl
          : typeof s.download_url === "string"
          ? s.download_url
          : undefined,
      imageUrl:
        typeof s.imageUrl === "string"
          ? s.imageUrl
          : typeof s.image_url === "string"
          ? s.image_url
          : undefined,
      title: typeof s.title === "string" ? s.title : undefined,
      tags: typeof s.tags === "string" ? s.tags : undefined,
      duration: typeof s.duration === "number" ? s.duration : undefined,
    };
  });
}

export async function createProducerTask(input: {
  model: ProducerModel;
  prompt: string;
  duration: number;
  quality: ProducerQuality;
}): Promise<{ taskId: string; raw: Record<string, any> }> {
  const response = await fetch(`${getJobsApiBase()}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "audio",
      provider: input.model,
      prompt: input.prompt,
      duration: input.duration,
      quality: input.quality,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Audio proxy create failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = asObject(await response.json());
  if (payload.ok === false) {
    throw new Error(String(payload.error || "Audio create failed"));
  }

  const taskId = parseTaskId(payload);
  if (!taskId) {
    throw new Error("Audio create did not return taskId");
  }
  return { taskId, raw: payload };
}

export async function getProducerTaskStatus(taskId: string): Promise<{
  status: string;
  songs: ProducerSong[];
  errorMessage?: string;
  raw: Record<string, any>;
}> {
  const response = await fetch(
    `${getJobsApiBase()}/api/jobs?type=audio&taskId=${encodeURIComponent(taskId)}`,
    { method: "GET" }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Audio proxy status failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = asObject(await response.json());
  const root = asObject(payload.raw ?? payload);
  const statusRaw =
    root.status ??
    root.state ??
    root.taskStatus ??
    root.task_status ??
    root?.data?.status ??
    root?.data?.state ??
    root?.result?.status ??
    "PENDING";

  const errorMessage =
    typeof root.errorMessage === "string"
      ? root.errorMessage
      : typeof root.error === "string"
      ? root.error
      : typeof root?.data?.errorMessage === "string"
      ? root.data.errorMessage
      : undefined;

  return {
    status: String(statusRaw).toUpperCase(),
    songs: normalizeSongs(payload),
    errorMessage,
    raw: payload,
  };
}
