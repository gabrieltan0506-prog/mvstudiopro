import {expect,it,vi} from 'vitest';
import {buildNativeDeepReadEpisodeExecution} from './manhuaTemplateLearnService';
it('保留安全的计划差异，不放宽校验、不落签名播放URL',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try {
  await buildNativeDeepReadEpisodeExecution({seriesKey:'s1',ep:{index:1,url:'https://test-only/video/1',title:'test',playbackUrl:'https://test-only/media?secret=never-log'} as any,segmentSeconds:300,videoFps:12,
   confirmedPlanEpisode:{episodeIndex:1,sourceUrl:'https://test-only/video/1',durationSec:600,segmentSeconds:300,videoFps:12,segments:[{startSec:0,endSec:300},{startSec:300,endSec:600}]} as any},
   {probeDuration:async()=>610,mediaSource:()=>({url:'https://test-only/media?secret=never-log'})});
  throw new Error('must reject');
 }catch(error:any){
  expect(error.message).toContain('与确认计划不一致');
  expect(error.nativePlanMismatch).toMatchObject({sourceMatches:true,durationSec:{expected:600,actual:610},segmentsMatch:false});
  expect(JSON.stringify(error.nativePlanMismatch)).not.toContain('https:');
  expect(JSON.stringify(warn.mock.calls)).not.toContain('never-log');
 }finally{warn.mockRestore();}
});
