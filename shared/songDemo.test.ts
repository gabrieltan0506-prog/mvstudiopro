import {it,expect} from 'vitest';
import {createSongDemoRuns,suggestedSongDemoLyrics} from './songDemo';
import {canvasMusicMvStateSchema,type SunoSongSession} from './canvasMusicMv';
const full='【Verse 1】主歌\n保留完整主歌\n【Chorus】副歌\n意想愛 unexpected love\n勇敢相爱\n【Outro】\nLove is brave';
const brief={model:'suno-v6' as const,custom_mode:true as const,instrumental:false,title:'意想爱',style:'73 BPM warm R&B',prompt:full,negative_tags:'noise',duration:300,style_weight:.7,weirdness_constraint:.2};
const session={requestId:'11111111-1111-4111-8111-111111111111',videoModel:'test',status:'succeeded',target:{sourceKey:'test',requirements:'优化'},proposal:{kind:'suno_song_v1',sourceKey:'test',evidenceId:'22222222-2222-4222-8222-222222222222',summaryZh:'优化',sections:[],uncertaintiesZh:[],transferableCraft:['变化'],review:{verdict:'approved',summaryZh:'通过',findings:[],mediaReview:[],inspirationZh:[],limitationsZh:[]},concepts:[0,1,2].map(i=>({id:`c${i}`,rationaleZh:'编曲',differenceZh:'层次',hookZh:'爱',brief:{...brief,style:brief.style+i}}))}} as SunoSongSession;
it('三个35秒短Demo使用同一展示片段；保存及选择仍携带完整歌词和300秒原brief',()=>{
 const excerpt=suggestedSongDemoLyrics(full);expect(excerpt).toBe('【Chorus】副歌\n意想愛 unexpected love\n勇敢相爱');let n=0;
 const runs=createSongDemoRuns(session,excerpt,()=>`33333333-3333-4333-8333-${String(++n).padStart(12,'0')}`);
 expect(runs).toHaveLength(3);expect(new Set(runs.map(r=>r.musicJobId)).size).toBe(3);
 for(const row of runs){expect(row.demoBrief.duration).toBe(35);expect(row.demoBrief.prompt).toBe(excerpt);expect(row.fullBrief.prompt).toBe(full);expect(row.fullBrief.duration).toBe(300);}
 const restored=canvasMusicMvStateSchema.parse(JSON.parse(JSON.stringify({status:'idle',candidates:[],songDemos:runs})));expect(restored.songDemos).toEqual(runs);
});
it('没有副歌不静默裁词；未通过审阅或空片段不能发Demo',()=>{
 expect(suggestedSongDemoLyrics('完整歌词没有段落标记')).toBe('');
 expect(()=>createSongDemoRuns(session,'',()=>crypto.randomUUID())).toThrow('歌词片段');
 expect(()=>createSongDemoRuns({...session,status:'failed'},'片段',()=>crypto.randomUUID())).toThrow('尚未');
});
