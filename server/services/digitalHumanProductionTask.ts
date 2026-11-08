import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { digitalHumanProductionRequestSchema, digitalHumanProductionInputSchema, type DigitalHumanProductionRequest } from "../../shared/digitalHumanProduction";
import { resolvePostProdInputSources } from "./postProdMediaSource";

export function digitalHumanProductionJobId(userId: number, requestId: string) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("需要有效登录账号");
  return `dhprod_${createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 48)}`;
}
export async function queueDigitalHumanProduction(userId: number, raw: DigitalHumanProductionRequest) {
  const request = digitalHumanProductionRequestSchema.parse(raw);
  const id = digitalHumanProductionJobId(userId, request.requestId);
  // 补充画面只保存 assetId+时间；入队前用 loadOwnedStockAsset 核对所有权与选段，不合格不建任务。
  if (request.input.action === "digital_human_final" && request.input.params.overlays?.length) {
    const { resolveDigitalHumanOverlays } = await import("./digitalHumanOverlay");
    await resolveDigitalHumanOverlays(userId, request.input.params.overlays, request.input.params.clips[request.input.params.clips.length - 1].endSec);
  }
  const input = await resolvePostProdInputSources({ userId: String(userId), input: request.input });
  const db = await getDb();
  if (!db) throw new Error("后期任务记录暂不可用，未创建任务");
  await db.insert(jobs).values({ id, userId: String(userId), type: "post_prod", provider: "ffmpeg-digital-human", status: "queued", attempts: 0, input }).onConflictDoNothing({ target: jobs.id });
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), eq(jobs.type, "post_prod")));
  if (!row || !isDeepStrictEqual(row.input, input)) throw new Error("该请求编号已绑定另一份输入，请核对原任务");
  return { jobId: row.id, status: row.status };
}
export async function getDigitalHumanProduction(userId: number, requestId: string) {
  const db = await getDb();
  if (!db) throw new Error("后期任务记录暂不可用");
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, digitalHumanProductionJobId(userId, requestId)), eq(jobs.userId, String(userId)), eq(jobs.type, "post_prod")));
  if (!row) return null;
  if (!digitalHumanProductionInputSchema.safeParse(row.input).success) throw new Error("原任务不属于数字人后期");
  return { jobId: row.id, status: row.status, output: row.output, error: row.error };
}
