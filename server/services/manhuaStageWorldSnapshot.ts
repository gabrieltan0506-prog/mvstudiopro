import { z } from "zod";
import { artMotionJobSchema, type ArtMotionJob } from "../../shared/artMotion";
import {
  ArtMotionArchiveUnavailable,
  artMotionSha,
  readArtMotionArchive,
  writeArtMotionArchive,
  writeWebsiteArtMotionArchive,
  readWebsiteArtMotionArchive,
} from "./artMotionArchive";
import type { ManhuaWorldTaskView } from "./manhuaWorldTask";

const identity = z.object({
  userId: z.string().regex(/^[1-9]\d*$/),
  requestId: z.string().uuid(),
});
const envelope = z.object({
  version: z.literal(1),
  userId: z.string(),
  requestId: z.string().uuid(),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  worldSha256: z.string().regex(/^[a-f0-9]{64}$/),
  world: z
    .object({
      taskId: z.string(),
      status: z.literal("succeeded"),
      sceneRef: z.string(),
      sourceVersion: z.string(),
      assets: z.object({ spz500kGcsUri: z.string() }).passthrough(),
    })
    .passthrough(),
});
const objectName = (userId: string, requestId: string) => {
  identity.parse({ userId, requestId });
  return `post-prod/${userId}/art-motion-inputs/${requestId}/stage-world.json`;
};
// JSONB会重排对象键；摘要依赖内容，不能依赖数据库返回的键顺序。
function canonicalInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalInput);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalInput(item)]));
  }
  return value;
}
const inputSha = (input: ArtMotionJob) =>
  artMotionSha(Buffer.from(JSON.stringify(canonicalInput(artMotionJobSchema.parse(input)))));
export async function archiveStageWorldSnapshot(
  userId: string,
  input: ArtMotionJob,
  world: ManhuaWorldTaskView
) {
  const bytes = Buffer.from(JSON.stringify(world));
  const snapshot = {
    version: 1,
    userId,
    requestId: input.requestId,
    inputSha256: inputSha(input),
    worldSha256: artMotionSha(bytes),
    world,
  };
  envelope.parse(snapshot);
  const key = objectName(userId, input.requestId),
    body = Buffer.from(JSON.stringify(snapshot));
  try {
    await writeArtMotionArchive(key, body);
  } catch (error) {
    // 冲突不是存储不可用，不能借回退绕开请求幂等保护。
    if (!(error instanceof ArtMotionArchiveUnavailable)) throw error;
    await writeWebsiteArtMotionArchive(key, body);
  }
}
export async function readStageWorldSnapshot(
  userId: string,
  input: ArtMotionJob,
  websiteFallback = false
): Promise<ManhuaWorldTaskView> {
  const bytes = await (
    websiteFallback ? readWebsiteArtMotionArchive : readArtMotionArchive
  )(objectName(userId, input.requestId));
  const snapshot = envelope.parse(JSON.parse(bytes.toString("utf8")));
  // 校验原始对象，避免 schema 字段排序改变内容摘要。
  const raw = JSON.parse(bytes.toString("utf8"));
  if (
    snapshot.userId !== userId ||
    snapshot.requestId !== input.requestId ||
    snapshot.inputSha256 !== inputSha(input) ||
    snapshot.worldSha256 !==
      artMotionSha(Buffer.from(JSON.stringify(raw.world))) ||
    snapshot.world.taskId !== input.params.stageAnimation?.worldTaskId
  )
    throw new Error("场景快照与当前动画请求不一致，未重新生成");
  return raw.world as ManhuaWorldTaskView;
}
