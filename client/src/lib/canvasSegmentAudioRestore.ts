import type { CanvasBlock } from './canvasTypes';
import { resolveClipLocalSegmentIndex } from '@shared/manhuaScriptWorkbench';
import { canvasAudioStudioSchema, canvasAudioCueInputKey, getSelectedAudioTake, emptyCanvasAudioStudio, type CanvasAudioStudio } from '@shared/canvasAudioStudio';

function sameSegment(target: CanvasBlock, source: CanvasBlock): boolean {
  // 无集号的旧自由节点不按默认集号推测归属。
  const hasSegment = (block: CanvasBlock) => /-(?:g|s)\d{2,}(?:-|$)/i.test(block.id) || /【第\s*\d+\s*段/.test(block.prompt ?? '');
  return target.kind === 'video' && source.kind === 'video' && target.id !== source.id
    && hasSegment(target) && hasSegment(source)
    && typeof target.episodeIndex === 'number' && target.episodeIndex === source.episodeIndex
    && resolveClipLocalSegmentIndex(target.id, target.prompt, target.episodeIndex)
      === resolveClipLocalSegmentIndex(source.id, source.prompt, source.episodeIndex);
}

function assertRestorable(source: CanvasBlock): CanvasAudioStudio {
  // 旧备份可能只保留长期音源身份；短期试听地址不作为恢复前提。
  const studio = canvasAudioStudioSchema.parse(source.audioStudio && {
    ...source.audioStudio,
    cues: source.audioStudio.cues.map(cue => ({ ...cue, source: cue.source && { ...cue.source, previewUrl: cue.source.previewUrl ?? '' } })),
  });
  if (source.status === 'running' || source.videoTaskStatus === 'queued' || studio.pendingOperations.length)
    throw new Error('原节点还有制作任务，请待任务结束后恢复。');
  if (!studio.cues.some(cue => cue.enabled && cue.approved)) throw new Error('原节点没有已采用音轨。');
  for (const cue of studio.cues.filter(cue => cue.enabled && cue.approved)) {
    const take = getSelectedAudioTake(cue);
    if (!take || take.inputKey !== canvasAudioCueInputKey(cue))
      throw new Error('原节点采用音频与台词或选段不一致，请先核对原版本。');
  }
  return studio;
}

export function findCanvasSegmentAudioSources(target: CanvasBlock, sources: readonly CanvasBlock[]): CanvasBlock[] {
  return sources.filter(source => {
    if (!sameSegment(target, source)) return false;
    try { assertRestorable(source); return true; } catch { return false; }
  });
}

/** 仅返回音轨数据；原节点、当前剧本、参考素材与视频均不修改。 */
export function restoreCanvasSegmentAudio(target: CanvasBlock, sources: readonly CanvasBlock[], sourceId: string, current = target.audioStudio ?? emptyCanvasAudioStudio()): CanvasAudioStudio {
  const source = sources.find(block => block.id === sourceId);
  if (!source || !sameSegment(target, source)) throw new Error('原节点不属于当前集和当前段，请重新选择。');
  if (target.status === 'running' || target.videoTaskStatus === 'queued' || current.pendingOperations.length)
    throw new Error('当前段还有制作任务，请待任务结束后恢复。');
  const original = assertRestorable(source);
  // 原记录作为停用音轨保留；不截断候选，不沿用已失效的合听预览。
  const ids = new Set(original.cues.map(cue => cue.id));
  const history = current.cues.map(cue => {
    let id = cue.id;
    let index = 1;
    while (ids.has(id)) id = `restore-history-${index++}-${cue.id}`;
    ids.add(id);
    return { ...cue, id, enabled: false };
  });
  return canvasAudioStudioSchema.parse({
    ...original, previewTake: undefined,
    cues: [...original.cues, ...history],
    musicJobIds: Array.from(new Set([...original.musicJobIds, ...current.musicJobIds])),
  });
}
