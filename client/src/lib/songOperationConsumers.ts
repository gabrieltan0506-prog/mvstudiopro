import type { CanvasMusicCandidate } from '@shared/canvasMusicMedia';
import type { SongOperationReceipt } from '@shared/songOperations';
import { canvasAudioCueInputKey, canvasAudioStudioSchema, createCanvasAudioCue, emptyCanvasAudioStudio, type CanvasAudioStudio } from '@shared/canvasAudioStudio';

export function songOperationCandidates(receipt: SongOperationReceipt): CanvasMusicCandidate[] {
  if (receipt.status !== 'succeeded' || !['cover', 'extend', 'replace'].includes(receipt.operation)) return [];
  return receipt.variants.map(v => {
    if (!v.url) throw new Error('歌曲播放地址尚未恢复，请查询原任务');
    return { id: `songop_${receipt.requestId}:${v.index}`, gcsUri: v.gcsUri, url: v.url, durationSec: v.durationSec, title: v.title || `${receipt.draft.title || receipt.draft.source.title || '歌曲'} · 版本 ${v.index + 1}`, sourceOperationId: receipt.requestId, sourceVariantIndex: v.index };
  });
}

export function songOperationStemMix(receipt: SongOperationReceipt, previous?: CanvasAudioStudio): CanvasAudioStudio {
  if (receipt.status !== 'succeeded' || receipt.operation !== 'stems' || !receipt.variants.length) throw new Error('分轨尚未成功');
  const state = previous || emptyCanvasAudioStudio();
  const additions = receipt.variants.filter(v => !state.cues.some(c => c.id === `songstem_${receipt.requestId}:${v.index}`)).map(v => {
    const cue = createCanvasAudioCue('bgm', `songstem_${receipt.requestId}:${v.index}`, v.durationSec);
    cue.labelZh = v.stem || v.title || `分轨 ${v.index + 1}`;
    cue.shotZh = receipt.draft.source.title || 'MV 歌曲混音';
    cue.source = { gcsUri: v.gcsUri, previewUrl: v.url || '', durationSec: v.durationSec, labelZh: cue.labelZh };
    cue.volume = 1;
    const take = { id: cue.id, gcsUri: v.gcsUri, previewUrl: v.url || '', durationSec: v.durationSec, requestId: receipt.requestId, createdAt: receipt.createdAt, inputKey: canvasAudioCueInputKey(cue) };
    cue.takes = [take];
    cue.selectedTakeId = take.id;
    cue.approved = true;
    return cue;
  });
  return canvasAudioStudioSchema.parse({ ...state, previewTake: additions.length ? undefined : state.previewTake, cues: [...state.cues, ...additions] });
}

/** 比较已审阅的创作字段；临时播放地址更新不改变用户决定。 */
export function songOperationDraftKey(draft: SongOperationReceipt['draft']): string {
  const fields = ['operation','sourceOperationId','sourceVariantIndex','title','prompt','style','negativeTags','instrumental','duration','audioWeight','styleWeight','weirdnessConstraint','continueAt','startSec','endSec','personaName','personaDescription','personaRequestId'] as const;
  return JSON.stringify([draft.source.id, draft.source.gcsUri || draft.source.url, draft.source.durationSec, ...fields.map(key => (key === "instrumental" || key === "audioWeight") && draft.operation !== "cover" ? null : key === "duration" && !["cover","extend"].includes(draft.operation) ? null : draft[key] ?? null)]);
}

export function songAlignmentInputKey(sourceId: string | undefined, alignment?: {requestId:string;sourceId:string}): string {
  return JSON.stringify([sourceId || null, alignment?.sourceId === sourceId ? alignment?.requestId || null : null]);
}

/** 控件与请求共享同一能力范围，避免提交供应商不支持的选项。 */
export function songOperationMusicOptions(operation: SongOperationReceipt['operation'], values: {instrumental:boolean;audioWeight:number;duration:number}) {
  if (operation === 'cover') return {instrumental:values.instrumental,audioWeight:values.audioWeight,duration:values.duration};
  if (operation === 'extend') return {duration:values.duration};
  return {};
}
