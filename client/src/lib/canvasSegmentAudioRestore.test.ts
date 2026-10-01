import { expect, it } from 'vitest';
import { defaultCanvasBlock } from './canvasTypes';
import { createCanvasAudioCue, canvasAudioCueInputKey, emptyCanvasAudioStudio, canvasAudioStudioSchema } from '@shared/canvasAudioStudio';
import { findCanvasSegmentAudioSources, restoreCanvasSegmentAudio } from './canvasSegmentAudioRestore';

const cue = { ...createCanvasAudioCue('dialogue', 'voice'), speakerId: 'mother', speakerZh: '娘', textZh: '原台词', voice: 'test-voice', startSec: 0, endSec: 4, shotZh: '原镜头' };
const take = { id: 'old-take', gcsUri: 'gs://test/original.wav', previewUrl: '', durationSec: 4, createdAt: '', inputKey: canvasAudioCueInputKey(cue) };
const source = { ...defaultCanvasBlock('video', 0, 0), id: 'clip-e01-g01-auto-old', episodeIndex: 1, archivedFromPreviousScript: true, audioStudio: { ...emptyCanvasAudioStudio(), musicJobIds: ['original-music'], cues: [{ ...cue, approved: true, selectedTakeId: take.id, takes: [take] }] } };
const target = { ...defaultCanvasBlock('video', 0, 0), id: 'clip-e01-g01-auto-current', episodeIndex: 1, prompt: '当前剧本保留', audioStudio: { ...emptyCanvasAudioStudio(), cues: [{ ...cue, textZh: '新草稿', takes: [take] }] } };

it('整段恢复原采用与身份，保留当前草稿且不修改节点', () => {
  const before = JSON.stringify([target, source]);
  const restored = restoreCanvasSegmentAudio(target, [source], source.id);
  expect(restored.cues[0]).toEqual(source.audioStudio.cues[0]);
  expect(restored.cues[1]).toMatchObject({ textZh: '新草稿', enabled: false, takes: [take] });
  expect(restored.cues[1]!.id).not.toBe(cue.id);
  expect(JSON.stringify([target, source])).toBe(before);
  expect(canvasAudioStudioSchema.parse(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
});
it('只列本集本段，第二段和不明集号均不可迁入', () => {
  for (const change of [{ episodeIndex: 2 }, { episodeIndex: undefined }, { id: 'clip-e01-g02-auto-old' }, { id: target.id }]) {
    const other = { ...source, ...change };
    expect(findCanvasSegmentAudioSources(target, [other])).toEqual([]);
    expect(() => restoreCanvasSegmentAudio(target, [other], other.id)).toThrow();
  }
  expect(findCanvasSegmentAudioSources(target, [source])).toEqual([source]);
});
it('来源变化不能伪造采用，未采用和输入指纹失效均拒绝', () => {
  for (const change of [{ approved: false }, { textZh: '已改原词' }, { selectedTakeId: 'missing' }]) {
    const other = { ...source, audioStudio: { ...source.audioStudio, cues: [{ ...source.audioStudio.cues[0]!, ...change }] } };
    expect(findCanvasSegmentAudioSources(target, [other])).toEqual([]);
    expect(() => restoreCanvasSegmentAudio(target, [other], other.id)).toThrow();
  }
});
it('源与目标在途任务均不覆盖', () => {
  const pending = { ...source.audioStudio, pendingOperations: [{ id: 'running', kind: 'dialogue' as const, inputKey: '' }] };
  expect(() => restoreCanvasSegmentAudio(target, [{ ...source, audioStudio: pending }], source.id)).toThrow('任务');
  expect(() => restoreCanvasSegmentAudio(target, [source], source.id, pending)).toThrow('任务');
  expect(() => restoreCanvasSegmentAudio({ ...target, status: 'running' }, [source], source.id)).toThrow('任务');
});
it('不静默裁切超长原声或丢候选，容量超限明确拒绝', () => {
  const long = { ...source, audioStudio: { ...source.audioStudio, cues: [{ ...source.audioStudio.cues[0]!, endSec: 30 }] } };
  expect(restoreCanvasSegmentAudio(target, [long], source.id).cues[0]!.endSec).toBe(30);
  const full = { ...target.audioStudio, cues: Array.from({ length: 100 }, (_, i) => ({ ...cue, id: `history-${i}` })) };
  expect(() => restoreCanvasSegmentAudio(target, [source], source.id, full)).toThrow();
});
it('不复用合听预览，保留原曲任务与目标历史任务', () => {
  const withPreview = { ...source, audioStudio: { ...source.audioStudio, previewTake: take } };
  const restored = restoreCanvasSegmentAudio(target, [withPreview], source.id, { ...target.audioStudio, musicJobIds: ['new-music', 'original-music'] });
  expect(restored.previewTake).toBeUndefined();
  expect(restored.musicJobIds).toEqual(['original-music', 'new-music']);
});
