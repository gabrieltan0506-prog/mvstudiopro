const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ttlMs = Number(process.env.VIDEO_SHORT_LINK_TTL_MS || DEFAULT_TTL_MS);
const memoryKey = "__MV_SHORT_LINKS__";

type LinkMap = Map<string, { videoUrl: string; expiresAt: number }>;

function getMemoryStore(): LinkMap {
  const bag = globalThis as typeof globalThis & { [memoryKey]?: LinkMap };
  if (!bag[memoryKey]) {
    bag[memoryKey] = new Map<string, { videoUrl: string; expiresAt: number }>();
  }
  return bag[memoryKey] as LinkMap;
}

function pruneExpired(store: LinkMap, now = Date.now()): void {
  for (const [taskId, item] of store.entries()) {
    if (item.expiresAt <= now) store.delete(taskId);
  }
}

function writeMemory(taskId: string, videoUrl: string): void {
  const store = getMemoryStore();
  pruneExpired(store);
  const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  store.set(taskId, { videoUrl, expiresAt: Date.now() + safeTtl });
}

function readMemory(taskId: string): string | null {
  const store = getMemoryStore();
  pruneExpired(store);
  const item = store.get(taskId);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    store.delete(taskId);
    return null;
  }
  return item.videoUrl;
}

async function getKv() {
  const hasKv =
    Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!hasKv) return null;
  try {
    return await import("@vercel/kv");
  } catch {
    return null;
  }
}

export async function setShortLink(taskId: string, videoUrl: string): Promise<void> {
  const cleanTaskId = taskId.trim();
  const cleanVideoUrl = videoUrl.trim();
  if (!cleanTaskId || !cleanVideoUrl) return;

  writeMemory(cleanTaskId, cleanVideoUrl);
  const kv = await getKv();
  if (!kv) return;

  try {
    await kv.set(`shortlink:${cleanTaskId}`, cleanVideoUrl, { ex: Math.max(1, Math.floor(ttlMs / 1000)) });
  } catch {
    // fallback to memory
  }
}

export async function getShortLink(taskId: string): Promise<string | null> {
  const cleanTaskId = taskId.trim();
  if (!cleanTaskId) return null;

  const kv = await getKv();
  if (kv) {
    try {
      const value = await kv.get<string>(`shortlink:${cleanTaskId}`);
      if (typeof value === "string" && value.trim()) {
        writeMemory(cleanTaskId, value);
        return value;
      }
    } catch {
      // fallback to memory
    }
  }

  return readMemory(cleanTaskId);
}

