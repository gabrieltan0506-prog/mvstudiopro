import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/(?:https?|gs|data|blob):|\bbearer\s|\bsk-[a-z0-9_-]{12,}/i.test(v), "分镜来源不得包含媒体地址或凭证");
/** 原文快照即本次来源版本，任何字段变化都应使旧建议失效。 */
export const advisorPrevisShotSourceSchema = z.object({
  version: z.literal(1),
  clipId: text(160),
  shots: z.array(z.object({
    index: z.number().int().positive(),
    startSec: z.number().finite().nonnegative(),
    endSec: z.number().finite().positive(),
    actionZh: text(20000),
    cameraZh: text(10000).optional(),
    dialogueZh: text(20000).optional(),
  }).strict()).min(1).max(120),
}).strict().superRefine((source, ctx) => {
  const seen = new Set<number>();
  let endSec = 0;
  source.shots.forEach((shot, i) => {
    if (seen.has(shot.index) || Math.abs(shot.startSec - endSec) > 0.00001 || shot.endSec <= shot.startSec) {
      ctx.addIssue({ code: "custom", path: ["shots", i], message: "分镜来源须逐镜唯一并连续覆盖本段秒窗" });
    }
    seen.add(shot.index); endSec = shot.endSec;
  });
  if (JSON.stringify(source).length > 120000) ctx.addIssue({ code: "custom", message: "本段分镜原文超过顾问容量，请先拆段；不会截断原文" });
});
export type AdvisorPrevisShotSource = z.infer<typeof advisorPrevisShotSourceSchema>;

export function buildAdvisorPrevisShotSource(clipId: string, shots: readonly { index: number; durationSec: number; actionZh: string; cameraZh?: string; dialogueZh?: string }[]): AdvisorPrevisShotSource {
  let cursor = 0;
  return advisorPrevisShotSourceSchema.parse({ version: 1, clipId, shots: shots.map(shot => {
    const startSec = cursor;
    if (!Number.isFinite(shot.durationSec) || shot.durationSec <= 0) throw new Error("分镜缺少有效片长，未建立顾问来源");
    cursor += shot.durationSec;
    return { index: shot.index, startSec, endSec: cursor, actionZh: shot.actionZh,
      ...(shot.cameraZh?.trim() ? { cameraZh: shot.cameraZh } : {}),
      ...(shot.dialogueZh?.trim() ? { dialogueZh: shot.dialogueZh } : {}),
    };
  }) });
}
