const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ttlMs = Number(process.env.VIDEO_SHORT_LINK_TTL_MS || DEFAULT_TTL_MS);
const inMemoryLinks = new Map<string, { videoUrl: string; expiresAt: number }>();

function pruneExpired(now = Date.now()): void {
  for (const [taskId, item] of inMemoryLinks.entries()) {
    if (item.expiresAt <= now) inMemoryLinks.delete(taskId);
  }
}

function writeInMemory(taskId: string, videoUrl: string): void {
  const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  inMemoryLinks.set(taskId, {
    videoUrl,
    expiresAt: Date.now() + safeTtl,
  });
}

export async function saveVideoShortLink(taskId: string, videoUrl: string): Promise<void> {
  const cleanTaskId = taskId.trim();
  const cleanVideoUrl = videoUrl.trim();
  if (!cleanTaskId || !cleanVideoUrl) return;
  pruneExpired();
  writeInMemory(cleanTaskId, cleanVideoUrl);
}

export async function getVideoUrlByTaskId(taskId: string): Promise<string | null> {
  const cleanTaskId = taskId.trim();
  if (!cleanTaskId) return null;
  pruneExpired();
  const item = inMemoryLinks.get(cleanTaskId);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    inMemoryLinks.delete(cleanTaskId);
    return null;
  }
  return item.videoUrl;
}

