import {it,expect,vi} from 'vitest';
import {refineSunoSongStyles} from './sunoStyleRefinement';
import {sunoSongBriefSchema} from '../../shared/canvasMusicMv';
import {manhuaBgmBriefSchema} from '../jobs/manhuaBgmJobInput';
const brief={model:'suno-v6' as const,custom_mode:true as const,instrumental:false,title:'意想爱',style:'完整音乐方向'.repeat(250),prompt:'【Chorus】\n原歌词',negative_tags:'noise',duration:300,style_weight:.78,weirdness_constraint:.25};
const candidate={kind:'suno_song_v1' as const,sourceKey:'same',summaryZh:'原始方案',sections:[],uncertaintiesZh:[],transferableCraft:['保留律动'],concepts:[0,1,2].map(i=>({id:'c'+i,rationaleZh:'依据',differenceZh:'编曲差别',hookZh:'意想爱',brief:{...brief}}))};
const target={sourceKey:'same',requirements:'只优化风格',originalBrief:brief};
const input={sourceTaskId:'same',mediaKind:'none' as const,sourceEvidence:{originalBrief:brief},candidate,requirements:'只优化风格'};
it('长style完整进入工作流schema与真实LLM入口；只消费模型精炼结果，不做字符串截断',async()=>{
 expect(sunoSongBriefSchema.parse(brief).style).toBe(brief.style);expect(manhuaBgmBriefSchema.parse(brief).style).toBe(brief.style);
 const proposal={...candidate,concepts:candidate.concepts.map((c,i)=>({...c,brief:{...c.brief,style:'模型语义精炼方向'+i}}))};
 const refine=vi.fn(async()=>({proposal,review:{model:'gpt-6-astra',verdict:'approved'}}));const save=vi.fn(async()=>{});
 const out=await refineSunoSongStyles(candidate,target,input,'gpt-6-astra',save,refine as any);
 expect(refine).toHaveBeenCalledTimes(1);expect((refine.mock.calls[0] as unknown as any[])[0].candidate.concepts[0].brief.style).toBe(brief.style);
 expect(out.proposal.concepts[0].brief.style).toBe('模型语义精炼方向0');expect(out.proposal.concepts[0].brief.prompt).toBe(brief.prompt);
});
it('LLM精炼若擅改歌词或其他字段则拒绝，保留原稿',async()=>{
 const proposal={...candidate,concepts:candidate.concepts.map(c=>({...c,brief:{...c.brief,style:'精炼',negative_tags:'擅改'}}))};
 await expect(refineSunoSongStyles(candidate,target,input,'gpt-6-astra',async()=>{},(async()=>({proposal,review:{model:'gpt-6-astra'}})) as any)).rejects.toThrow('授权范围外');
});
