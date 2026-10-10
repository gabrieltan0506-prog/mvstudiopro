import { createHash } from "node:crypto";
import { artMotionJobSchema, type ArtMotionJob } from "../../shared/artMotion";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository";

export function artMotionTaskId(userId: string, requestId: string) {
  return `art_${createHash("sha256")
    .update(JSON.stringify([userId, requestId]))
    .digest("hex")
    .slice(0, 48)}`;
}
type Row = {
  id: string;
  userId: string;
  type: string;
  status: string;
  input: unknown;
};
export type ArtMotionQueueDeps = {
  load(id: string): Promise<Row | null>;
  insert(id: string, userId: string, input: ArtMotionJob): Promise<void>;
};
const real: ArtMotionQueueDeps = {
  load: getJobByIdStrict,
  async insert(id, userId, input) {
    const db = await getDb();
    if (!db) throw new Error("动画任务暂时无法保存，请保留请求编号");
    await db
      .insert(jobs)
      .values({
        id,
        userId,
        type: "post_prod",
        provider: "canvas-art-motion",
        status: "queued",
        input,
        attempts: 0,
      })
      .onConflictDoNothing({ target: jobs.id });
  },
};
export async function queueArtMotion(
  userId: string,
  raw: unknown,
  deps: ArtMotionQueueDeps = real
) {
  const input = artMotionJobSchema.parse(raw),
    id = artMotionTaskId(userId, input.requestId);
  let row = await deps.load(id);
  if (!row) {
    // 映客的新编排必须从已保存作品入口领取名额，通用后期不能绕过该门禁。
    if (
      input.scopeKey.startsWith("code-motion:") ||
      input.params.composition ||
      input.params.codeAudio ||
      input.params.codeVideo ||
      input.params.inkSpeech
    )
      throw new Error(
        "请从映客已保存作品入口确认并导出，本入口不会新建映客任务"
      );
    if (input.params.stageAnimation) {
      const { resolveManhuaStageAnimationSource } = await import(
        "./manhuaStageAnimationSource"
      );
      const { archiveStageWorldSnapshot } = await import(
        "./manhuaStageWorldSnapshot"
      );
      const source = await resolveManhuaStageAnimationSource(
        userId,
        input.params,
        input.requestId
      );
      await archiveStageWorldSnapshot(userId, input, source.world);
    }
    await deps.insert(id, userId, input);
    row = await deps.load(id);
  }
  if (!row) throw new Error("动画任务回执未确认，请用原请求编号续查");
  const stored = artMotionJobSchema.safeParse(row.input);
  if (
    row.userId !== userId ||
    row.type !== "post_prod" ||
    !stored.success ||
    JSON.stringify(stored.data) !== JSON.stringify(input)
  )
    throw new Error("同一动画请求编号不能用于不同作品或参数");
  return { jobId: id, status: row.status };
}
