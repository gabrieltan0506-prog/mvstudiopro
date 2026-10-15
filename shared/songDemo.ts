import type {SunoSongSession,SongDemoRun} from './canvasMusicMv';
export const SONG_DEMO_SECONDS=35;
/** 仅取展示给用户的副歌片段；不修改另存的完整版歌词。没有副歌时由用户填写片段。 */
export function suggestedSongDemoLyrics(lyrics:string):string {
 const lines=lyrics.split(/\r?\n/);const start=lines.findIndex(line=>/^\s*(?:\[Chorus[^\]]*\]|【Chorus[^】]*】)/i.test(line));
 if(start<0)return '';
 const end=lines.findIndex((line,index)=>index>start&&/^\s*(?:\[[^\]]+\]|【[^】]+】)/.test(line));
 return lines.slice(start,end<0?undefined:end).join('\n').trim();
}
export function createSongDemoRuns(session:SunoSongSession,excerpt:string,uuid:()=>string):SongDemoRun[]{
 if(session.status!=='succeeded'||session.proposal?.concepts.length!==3||session.proposal.review?.verdict!=='approved')throw Error('三套编曲方案尚未审阅通过');
 if(!excerpt.trim()||excerpt.length>1500)throw Error('请填写本次Demo的歌词片段（最多1500字）');
 return session.proposal.concepts.map(concept=>{
  const requestId=uuid();return {requestId,advisorRequestId:session.requestId,conceptId:concept.id,fullBrief:concept.brief,demoBrief:{...concept.brief,duration:SONG_DEMO_SECONDS,prompt:excerpt.trim()},musicJobId:`bgm_${requestId.replace(/-/g,'')}`,status:'submitting',variants:[]};
 });
}
