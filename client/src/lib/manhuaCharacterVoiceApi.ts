/**
 * 成片抠声线 / 声线锁客户端调用。
 */
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";

export async function extractManhuaClipAudio(input: {
  videoUrl: string;
  startSec?: number;
  durationSec?: number;
}): Promise<{
  audioUrl: string;
  startSec: number;
  durationSec: number;
}> {
  const url = withLongJobsFlyDirect("/api/jobs?op=extractClipAudio");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({
      videoUrl: input.videoUrl,
      startSec: input.startSec ?? 0,
      durationSec: input.durationSec ?? 8,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    audioUrl?: string;
    startSec?: number;
    durationSec?: number;
    error?: string;
  };
  if (!res.ok || !json.audioUrl) {
    throw new Error(json.error || "音频提取失败");
  }
  return {
    audioUrl: String(json.audioUrl),
    startSec: Number(json.startSec) || 0,
    durationSec: Number(json.durationSec) || 8,
  };
}
