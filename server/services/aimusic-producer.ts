const PRODUCER_API_BASE =
  process.env.AIMUSIC_API_BASE || "https://api.aimusicapi.ai/api/v1/producer";
const PRODUCER_API_KEY = process.env.AIMUSIC_API_KEY || "";

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

function getHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (PRODUCER_API_KEY) {
    headers.Authorization = `Bearer ${PRODUCER_API_KEY}`;
  }
  return headers;
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
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function normalizeSongs(statusPayload: Record<string, any>): ProducerSong[] {
  const list =
    statusPayload.songs ||
    statusPayload.tracks ||
    statusPayload.items ||
    statusPayload?.data?.songs ||
    statusPayload?.data?.tracks ||
    statusPayload?.result?.songs ||
    statusPayload?.result?.tracks ||
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
  const response = await fetch(`${PRODUCER_API_BASE}/create`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Producer create failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = asObject(await response.json());
  const taskId = parseTaskId(payload);
  if (!taskId) {
    throw new Error("Producer create did not return taskId");
  }

  return { taskId, raw: payload };
}

export async function getProducerTaskStatus(taskId: string): Promise<{
  status: string;
  songs: ProducerSong[];
  errorMessage?: string;
  raw: Record<string, any>;
}> {
  let response = await fetch(`${PRODUCER_API_BASE}/status`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ taskId }),
  });

  if (!response.ok) {
    response = await fetch(`${PRODUCER_API_BASE}/status?taskId=${encodeURIComponent(taskId)}`, {
      headers: getHeaders(),
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Producer status failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = asObject(await response.json());
  const statusRaw =
    payload.status ??
    payload.state ??
    payload.taskStatus ??
    payload.task_status ??
    payload?.data?.status ??
    payload?.data?.state ??
    payload?.result?.status ??
    "PENDING";

  const errorMessage =
    typeof payload.errorMessage === "string"
      ? payload.errorMessage
      : typeof payload.error === "string"
      ? payload.error
      : typeof payload?.data?.errorMessage === "string"
      ? payload.data.errorMessage
      : undefined;

  return {
    status: String(statusRaw).toUpperCase(),
    songs: normalizeSongs(payload),
    errorMessage,
    raw: payload,
  };
}
