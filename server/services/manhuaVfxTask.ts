import { createHash } from "node:crypto";
import { manhuaVfxJobSchema, type ManhuaVfxJob } from "../../shared/manhuaVfx";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository";
import { extractSystemObjectName } from "./postProdMediaSource";
import { resolveManhuaVfxSceneSource } from "./manhuaVfxSceneSource";

export function manhuaVfxTaskId(userId: string, requestId: string) {
  return `vfx_${createHash("sha256").update(JSON.stringify([userId, requestId])).digest("hex").slice(0, 48)}`;
}
type Row = { id: string; userId: string; type: string; status: string; input: unknown };
export type VfxQueueDeps = { load(id: string): Promise<Row | null>; insert(id: string, userId: string, input: ManhuaVfxJob): Promise<void> };
const real: VfxQueueDeps = {
  load: getJobByIdStrict,
  async insert(id, userId, input) {
    for (const effect of input.params.composition.effects) {
      if (effect.bullet) await resolveManhuaVfxSceneSource(effect.bullet, userId);
      if (effect.world) {
        const source = await resolveManhuaVfxSceneSource(effect.world, userId);
        if (effect.world.sourceStartSec + effect.durationSec > source.durationSec + 1e-9) throw new Error("人物活动时窗超出已保存三维动画");
      }
    }
    const db = await getDb();
    if (!db) throw new Error("暂时无法保存任务，请保留原请求编号稍后查询");
    await db.insert(jobs).values({ id, userId, type: "post_prod", provider: "blender-vfx", status: "queued", input, attempts: 0 })
      .onConflictDoNothing({ target: jobs.id });
  },
};
/** Receipt lookup checks immutable input and owner; it never submits work or requires a still-listed source. */
export async function findManhuaVfxReceipt(userId: string, raw: unknown, deps: VfxQueueDeps = real) {
  const input = manhuaVfxJobSchema.parse(raw);
  const row = await deps.load(manhuaVfxTaskId(userId, input.requestId));
  if (!row) return null;
  const stored = manhuaVfxJobSchema.safeParse(row.input);
  if (row.userId !== userId || row.type !== "post_prod" || !stored.success)
    throw new Error("同一请求编号不能用于不同作品、来源或特效配置");
  const bucket = /^gs:\/\/([^/]+)\//.exec(stored.data.params.videoUri)?.[1];
  const objectName = bucket && extractSystemObjectName(input.params.videoUri, bucket);
  const compared = { ...input, params: { ...input.params, videoUri: objectName ? `gs://${bucket}/${objectName}` : input.params.videoUri } };
  if (JSON.stringify(compared) !== JSON.stringify(stored.data))
    throw new Error("同一请求编号不能用于不同作品、来源或特效配置");
  return { jobId: row.id, status: row.status };
}
/** Caller has resolved source ownership. Conflict never overwrites or reschedules the original request. */
export async function queueManhuaVfx(userId: string, raw: unknown, deps: VfxQueueDeps = real) {
  const input = manhuaVfxJobSchema.parse(raw);
  const id = manhuaVfxTaskId(userId, input.requestId);
  let row = await deps.load(id);
  if (!row) { await deps.insert(id, userId, input); row = await deps.load(id); }
  if (!row) throw new Error("特效任务回执尚未确认，请保留原请求编号查询");
  const stored = manhuaVfxJobSchema.safeParse(row.input);
  if (row.userId !== userId || row.type !== "post_prod" || !stored.success || JSON.stringify(stored.data) !== JSON.stringify(input))
    throw new Error("同一请求编号不能用于不同作品、来源或特效配置");
  return { jobId: id, status: row.status };
}
