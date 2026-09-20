import { expect, it } from 'vitest';
import { createCanvasAudioCue, canvasAudioCueInputKey, emptyCanvasAudioStudio, canvasAudioStudioSchema } from '@shared/canvasAudioStudio';
import { defaultCanvasBlock } from './canvasTypes';
import { findCanvasDialogueReuse, restoreCanvasDialogueCandidate } from './canvasDialogueReuse';
const original = { ...createCanvasAudioCue('dialogue', 'old-cue'), speakerZh: '娘', textZh: '阿菁……慢点，我喘不上来。', emotion: '[tired]', voice: 'test-voice' };
const take = { id: 'existing-take', gcsUri: 'gs://test/original.wav', previewUrl: '', durationSec: 4.944, createdAt: '', inputKey: canvasAudioCueInputKey(original) };
const source = { ...defaultCanvasBlock('video',0,0), id: 'old', episodeIndex: 1, audioStudio: { ...emptyCanvasAudioStudio(), cues: [{ ...original, takes: [take] }] } };
const target = { ...defaultCanvasBlock('video',0,0), id: 'new', episodeIndex: 1 };
const cue = { ...original, id: 'new-cue', startSec: 6, endSec: 10, voice: '', emotion: '' };
it('找回原声保留身份和新时间窗，不自动采用，往返存储保留', () => {
 const candidates=findCanvasDialogueReuse(target,cue,[source]);
 const restored=restoreCanvasDialogueCandidate(target,cue,[source],candidates[0]!);
 expect(restored.takes).toEqual([take]);expect(restored.startSec).toBe(6);expect(restored.endSec).toBe(10);
 expect(restored.approved).toBe(false);expect(restored.selectedTakeId).toBeUndefined();expect(restored.voice).toBe('test-voice');
 expect(source.audioStudio.cues[0].takes).toEqual([take]);
 expect(canvasAudioStudioSchema.parse(JSON.parse(JSON.stringify({...emptyCanvasAudioStudio(),cues:[restored]}))).cues[0].takes[0].id).toBe(take.id);
 expect(findCanvasDialogueReuse(target,restored,[source])).toEqual([]);
});
it('不同台词、状态、集数和旧音色候选不能混入', () => {
 for(const changed of [{textZh:'不同台词'},{voiceStateZh:'青年'},{speakerZh:'阿菁'}]) expect(findCanvasDialogueReuse(target,{...cue,...changed},[source])).toEqual([]);
 expect(findCanvasDialogueReuse({...target,episodeIndex:2},cue,[source])).toEqual([]);
 expect(findCanvasDialogueReuse(target,cue,[{...source,audioStudio:{...source.audioStudio,cues:[{...original,voice:'changed',takes:[take]}]}}])).toEqual([]);
});
it('点击时源变化或容量满拒绝导入，不覆盖原候选', () => {
 const candidate=findCanvasDialogueReuse(target,cue,[source])[0]!;
 expect(()=>restoreCanvasDialogueCandidate(target,{...cue,textZh:'已改'},[source],candidate)).toThrow('已变化');
 expect(()=>restoreCanvasDialogueCandidate(target,{...cue,takes:Array.from({length:100},(_,i)=>({...take,id:`other-${i}`}))},[source],candidate)).toThrow('已满');
});
