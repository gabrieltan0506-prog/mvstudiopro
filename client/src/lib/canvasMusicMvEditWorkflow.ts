import { manhuaSourceVersionIdentity } from "@shared/manhuaMultiview";
import type { CanvasBlock } from "./canvasTypes";
import type { CanvasMusicMvPlan } from "@shared/canvasMusicMv";
import {
  musicMvEditDocumentSchema,
  type MusicMvEditDocument,
} from "@shared/canvasMusicMvEdit";
import { resolveMusicMvMediaUrl } from "./musicMvAdvisor";
import { readMvVideoDuration } from "./musicMvAdvisor";

export function initialMusicMvEdit(
  plan: CanvasMusicMvPlan,
  basePlanRequestId: string,
  ids: string[]
): MusicMvEditDocument {
  if (ids.length !== plan.shots.length) throw new Error("请先铺设完整镜头");
  return musicMvEditDocumentSchema.parse({
    version: 1,
    fps: 30,
    basePlanRequestId,
    audioId: plan.audioId,
    audioDurationSec: plan.audioDurationSec,
    clips: plan.shots.map((s, i) => ({
      id: crypto.randomUUID(),
      shotId: s.id,
      blockId: ids[i],
      title: s.visualPrompt,
      kind: s.kind || "generated",
      sourceInFrame: Math.round((s.sourceClip?.sourceStartSec || 0) * 30),
      durationFrames: Math.round(s.endSec * 30) - Math.round(s.startSec * 30),
    })),
  });
}
/** 只读取已有媒体；不触发生成，不默默替换编辑中已经绑定的素材。 */
export async function syncMusicMvEditSources(
  doc: MusicMvEditDocument,
  blocks: CanvasBlock[]
): Promise<MusicMvEditDocument> {
  const clips = [...doc.clips];
  const cache = new Map<string, number>();
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.source) continue;
    const b = blocks.find(b => b.id === c.blockId);
    if (!b || b.status !== "done" || !b.outputUrl) continue;
    if (
      b.musicMvShot?.planRequestId !== doc.basePlanRequestId ||
      b.musicMvShot.shotId !== c.shotId
    )
      throw new Error("镜头绑定已变化");
    const source =
      b.musicMvShot.kind === "footage" ? b.musicMvShot.sourceClip : undefined;
    const url = source?.url || b.outputUrl;
    const taskId =
      source?.taskId ||
      b.musicMvShot.outputs?.find(
        o =>
          manhuaSourceVersionIdentity(o.url) ===
          manhuaSourceVersionIdentity(url)
      )?.taskId ||
      b.videoTaskId;
    const durationSec =
      cache.get(url) ??
      (await readMvVideoDuration(await resolveMusicMvMediaUrl(url)));
    cache.set(url, durationSec);
    clips[i] = { ...c, source: { url, taskId, durationSec } };
  }
  return musicMvEditDocumentSchema.parse({ ...doc, clips });
}
