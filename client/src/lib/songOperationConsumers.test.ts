import { describe, expect, it } from 'vitest';
import { songOperationCandidates, songOperationStemMix } from './songOperationConsumers';
import type { SongOperationReceipt } from '@shared/songOperations';
import { canvasAudioCueInputKey, getSelectedAudioTake, validateCanvasAudioCue } from '@shared/canvasAudioStudio';
const receipt: SongOperationReceipt = {
 requestId:'bbd234fd-6e9e-418a-8723-e640126f2320', operation:'stems', sourceId:'original',status:'succeeded',inputDigest:'a'.repeat(64),createdAt:'2026-10-16T06:00:00Z',creditsCost:null,
 draft:{operation:'stems',source:{id:'original',url:'https://example.com/original.mp3',durationSec:240}},
 variants:[{index:0,gcsUri:'gs://test/vocal.mp3',url:'https://example.com/vocal.mp3',durationSec:240,stem:'人声'},{index:1,gcsUri:'gs://test/drums.mp3',url:'https://example.com/drums.mp3',durationSec:240,stem:'鼓'}]
};
describe('歌曲编辑结果消费',()=>{
 it('分轨保留完整240秒，并成为现有混音可消费的已采用take',()=>{
  const mix=songOperationStemMix(receipt);
  expect(mix.cues).toHaveLength(2);
  for(const cue of mix.cues){expect(cue.endSec).toBe(240);expect(validateCanvasAudioCue(cue,240)).toEqual([]);expect(getSelectedAudioTake(cue)?.inputKey).toBe(canvasAudioCueInputKey(cue));expect(cue.approved).toBe(true);}
  expect(songOperationStemMix(receipt,mix)).toEqual(mix);
 });
 it('失败和非分轨回执不能进入混音',()=>{
  expect(()=>songOperationStemMix({...receipt,status:'failed'})).toThrow();
  expect(()=>songOperationStemMix({...receipt,operation:'cover'})).toThrow();
 });
 it('歌曲所有变体保留派生身份，分轨不会冒充完整歌曲',()=>{
  expect(songOperationCandidates(receipt)).toEqual([]);
  const candidates=songOperationCandidates({...receipt,operation:'extend'});
  expect(candidates).toHaveLength(2);expect(candidates[1]).toMatchObject({sourceOperationId:receipt.requestId,sourceVariantIndex:1,durationSec:240});
 });
 it('播放地址缺失时不能伪装可试听候选',()=>expect(()=>songOperationCandidates({...receipt,operation:'cover',variants:[{...receipt.variants[0],url:undefined}]})).toThrow('播放地址'));
});

describe('编辑与字幕版本键',()=>{
 it('歌词变化失效，播放签名变化不失效',async()=>{
  const {songOperationDraftKey}=await import('./songOperationConsumers');
  const a={...receipt.draft,prompt:'原歌词'};
  expect(songOperationDraftKey(a)).not.toBe(songOperationDraftKey({...a,prompt:'新歌词'}));
  const source={...a.source,gcsUri:'gs://test/source.mp3'};
  expect(songOperationDraftKey({...a,source})).toBe(songOperationDraftKey({...a,source:{...source,url:'https://example.com/refreshed.mp3'}}));
 });
 it('字幕切换和清除产生不同合成键，其他歌曲字幕不串用',async()=>{
  const {songAlignmentInputKey}=await import('./songOperationConsumers');
  const a={sourceId:'song',requestId:'alignment-a'};
  expect(songAlignmentInputKey('song',a)).not.toBe(songAlignmentInputKey('song',{...a,requestId:'alignment-b'}));
  expect(songAlignmentInputKey('song',a)).not.toBe(songAlignmentInputKey('song'));
  expect(songAlignmentInputKey('other',a)).toBe(songAlignmentInputKey('other'));
 });
});

describe('SONG-R1-002 支持参数边界',()=>{
 it('仅cover发送纯器乐和参考强度，extend只发送目标时长，replace不发送这些选项',async()=>{
  const {songOperationMusicOptions}=await import('./songOperationConsumers');
  const values={instrumental:true,audioWeight:0.72,duration:120};
  expect(songOperationMusicOptions('cover',values)).toEqual(values);
  expect(songOperationMusicOptions('extend',values)).toEqual({duration:120});
  expect(songOperationMusicOptions('replace',values)).toEqual({});
 });
 it('非cover旧instrumental不进入有效创作键，cover强度和时长变化使报价失效',async()=>{
  const {songOperationDraftKey}=await import('./songOperationConsumers');
  const draft={...receipt.draft,operation:'extend' as const};
  expect(songOperationDraftKey(draft)).toBe(songOperationDraftKey({...draft,instrumental:true,audioWeight:0.9}));
  const replace={...draft,operation:"replace" as const};
  expect(songOperationDraftKey(replace)).toBe(songOperationDraftKey({...replace,duration:180}));
  const cover={...draft,operation:'cover' as const,audioWeight:0.5,duration:120};
  expect(songOperationDraftKey(cover)).not.toBe(songOperationDraftKey({...cover,audioWeight:0.7}));
  expect(songOperationDraftKey(cover)).not.toBe(songOperationDraftKey({...cover,duration:180}));
 });
});
