import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

const videoShortLinks = mysqlTable("video_short_links", {
  taskId: varchar("taskId", { length: 128 }).primaryKey(),
  videoUrl: text("videoUrl").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ttlMs = Number(process.env.VIDEO_SHORT_LINK_TTL_MS || DEFAULT_TTL_MS);
const inMemoryLinks = new Map<string, { videoUrl: string; expiresAt: number }>();

function getDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  try {
    return drizzle(url);
  } catch {
    return null;
  }
}

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

  const db = getDb();
  if (!db) return;
  try {
    await db
      .insert(videoShortLinks)
      .values({ taskId: cleanTaskId, videoUrl: cleanVideoUrl })
      .onDuplicateKeyUpdate({
        set: {
          videoUrl: cleanVideoUrl,
          updatedAt: new Date(),
        },
      });
  } catch {
    // no-op: in-memory fallback already stored
  }
}

export async function getVideoUrlByTaskId(taskId: string): Promise<string | null> {
  const cleanTaskId = taskId.trim();
  if (!cleanTaskId) return null;

  pruneExpired();

  const db = getDb();
  if (db) {
    try {
      const rows = await db
        .select({ videoUrl: videoShortLinks.videoUrl })
        .from(videoShortLinks)
        .where(eq(videoShortLinks.taskId, cleanTaskId))
        .limit(1);
      if (rows.length > 0 && rows[0].videoUrl) {
        writeInMemory(cleanTaskId, rows[0].videoUrl);
        return rows[0].videoUrl;
      }
    } catch {
      // fallback to memory
    }
  }

  const item = inMemoryLinks.get(cleanTaskId);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    inMemoryLinks.delete(cleanTaskId);
    return null;
  }
  return item.videoUrl;
}

