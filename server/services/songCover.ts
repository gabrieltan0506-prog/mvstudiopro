import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository";
import { sunoSongBriefSchema } from "../../shared/canvasMusicMv";
import { buildSongCoverPrompt } from "../../shared/songCover";
import { buildCanvasGptImage2JobInput } from "../../shared/canvasGptImage2JobInput";
export function songCoverJob(
  userId: number,
  musicJobId: string,
  raw: unknown,
  confirmedPrompt: string,
  aspectRatio: "9:16" | "1:1" = "9:16"
) {
  const brief = sunoSongBriefSchema.parse(raw);
  const prompt = buildSongCoverPrompt(brief, aspectRatio);
  if (prompt !== confirmedPrompt)
    throw Error("封面内容与歌曲原提交不一致，请查看原提交内容");
  return {
    id: `songcover_${createHash("sha256")
      .update(
        `${userId}:${musicJobId}${aspectRatio === "1:1" ? ":album-1x1" : ""}`
      )
      .digest("hex")
      .slice(0, 48)}`,
    input: buildCanvasGptImage2JobInput({
      prompt,
      aspectRatio,
      generalImageEdit: true,
      openaiImageVariant: "flare",
      requireImageVariant: true,
      providerOverride: "openai",
      imageLane: "asset",
      gcsSubdir: "song-covers",
    }),
  };
}
/** 沿用图片worker的鉴权、永久存储、计费和退款；每个歌曲任务的同一尺寸至多一张封面，旧尺寸回执保留。 */
export async function queueSongCover(
  userId: number,
  musicJobId: string,
  confirmedPrompt: string,
  aspectRatio: "9:16" | "1:1" = "9:16"
) {
  const music = await getJobByIdStrict(musicJobId);
  const source = music?.input as
    | { action?: string; params?: { brief?: unknown } }
    | undefined;
  if (
    !music ||
    music.userId !== String(userId) ||
    source?.action !== "manhua_bgm_v55"
  )
    throw Error("歌曲任务不存在或无权访问");
  if (music.status !== "succeeded") throw Error("歌曲尚未成功，未提交封面");
  const task = songCoverJob(
    userId,
    musicJobId,
    source.params?.brief,
    confirmedPrompt,
    aspectRatio
  );
  const db = await getDb();
  if (!db) throw Error("封面任务记录暂不可用");
  await db
    .insert(jobs)
    .values({
      id: task.id,
      userId: String(userId),
      type: "image",
      provider: "openai-gpt-image-2",
      status: "queued",
      attempts: 0,
      input: task.input,
    })
    .onConflictDoNothing({ target: jobs.id });
  const [saved] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, task.id), eq(jobs.userId, String(userId))));
  if (!saved || JSON.stringify(saved.input) !== JSON.stringify(task.input)) {
    // JSONB字段顺序不构成输入变化。
    const { isDeepStrictEqual } = await import("node:util");
    if (!saved || !isDeepStrictEqual(saved.input, task.input))
      throw Error("封面原请求内容冲突，未重新生成");
  }
  return { jobId: task.id, status: saved.status };
}
