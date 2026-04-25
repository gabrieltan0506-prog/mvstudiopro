/**
 * Growth / MVAnalysis：AIM 音乐轮询与下载共用逻辑（避免 MVAnalysis vs GrowthCamp 分叉、减少 0 字节 MP3）
 */

export function getMusicClipsFromJobPayload(j: unknown): any[] {
  const obj = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  const root =
    (obj.raw as Record<string, unknown>) ||
    ((obj.json as Record<string, unknown>)?.raw as Record<string, unknown>) ||
    (obj.json as Record<string, unknown>) ||
    obj ||
    {};
  const nestedRaw =
    root && typeof root.raw === "object" && root.raw
      ? (root.raw as Record<string, unknown>)
      : root;

  const list =
    nestedRaw.songs ||
    nestedRaw.tracks ||
    nestedRaw.items ||
    (nestedRaw.data as unknown) ||
    nestedRaw.result ||
    [];

  if (Array.isArray(list)) return list;
  const data = nestedRaw.data;
  if (Array.isArray(data)) return data;
  return [];
}

function firstNonEmptyString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/** 下载档案优先使用专用 download URL，再退回串流/预览 URL */
export function clipToGeneratedSong(clip: any, idx: number): {
  id: string;
  title: string;
  audioUrl?: string;
  streamUrl?: string;
  imageUrl?: string;
  duration?: number;
  tags?: string;
} {
  const c = clip && typeof clip === "object" ? clip : {};
  const fileLike = firstNonEmptyString(
    c.download_url,
    c.downloadUrl,
    c.audio_url,
    c.audioUrl,
  );
  const streamLike = firstNonEmptyString(c.stream_url, c.streamUrl);
  const primary = fileLike || streamLike;
  const alt =
    fileLike && streamLike && fileLike !== streamLike ? streamLike : undefined;
  return {
    id: String(c.clip_id ?? c.id ?? c.trackId ?? c.track_id ?? idx),
    title: String(c.title || "生成结果"),
    audioUrl: primary || undefined,
    streamUrl: alt,
    imageUrl: typeof c.image_url === "string" ? c.image_url : typeof c.imageUrl === "string" ? c.imageUrl : undefined,
    duration: typeof c.duration === "number" ? c.duration : undefined,
    tags: typeof c.tags === "string" ? c.tags : undefined,
  };
}

/** 后端 audio job 的 output.songs（或 AIM clip）统一成前端结构 */
export function normalizeSongsFromAudioJobOutput(songs: unknown): Array<{
  id: string;
  title: string;
  audioUrl?: string;
  streamUrl?: string;
  imageUrl?: string;
  duration?: number;
  tags?: string;
}> {
  if (!Array.isArray(songs)) return [];
  return songs.map((clip, idx) => clipToGeneratedSong(clip, idx));
}

export function songDownloadUrlCandidates(song: {
  audioUrl?: string;
  streamUrl?: string;
}): string[] {
  const out: string[] = [];
  const a = song.audioUrl?.trim();
  const s = song.streamUrl?.trim();
  if (a) out.push(a);
  if (s && s !== a) out.push(s);
  return out;
}

const MIN_AUDIO_BYTES = 512;

export async function downloadGeneratedMusicToFile(
  urls: string[],
  title?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const nameBase = `${(title || "bgm").trim() || "bgm"}.mp3`;
  const tried: string[] = [];

  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;
    tried.push(url);
    try {
      const resp = await fetch(url, {
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (blob.size < MIN_AUDIO_BYTES) continue;
      const ct = (resp.headers.get("content-type") || blob.type || "").toLowerCase();
      if (ct.includes("text/html")) continue;

      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = nameBase;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      return { ok: true };
    } catch {
      continue;
    }
  }

  const detail = tried.length ? `（已尝试 ${tried.length} 个地址）` : "";
  return {
    ok: false,
    message: `音频下载失败：未获取到有效文件内容${detail}。请检查网络或稍后重试，或尝试用浏览器的「打开链接」在新标签页下载。`,
  };
}
