/**
 * 成片左上角标后期修补（客户端）。
 */
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";

export async function eraseAiCornerMark(input: {
  videoUrl: string;
}): Promise<{ videoUrl: string; bytes: number }> {
  const url = withLongJobsFlyDirect("/api/jobs?op=eraseAiCornerMark");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ videoUrl: input.videoUrl }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    videoUrl?: string;
    bytes?: number;
    error?: string;
  };
  if (!res.ok || !json.videoUrl) {
    throw new Error(json.error || "清除角标失败");
  }
  return {
    videoUrl: String(json.videoUrl).trim(),
    bytes: Number(json.bytes) || 0,
  };
}
