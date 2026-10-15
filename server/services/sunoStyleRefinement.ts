import {refineCreativeProposal} from './creativeAstraRefinement';
import {parseSunoSongProposal,type SunoSongTarget} from '../../shared/canvasMusicMv';
import type {CreativeEvidenceReviewInput} from '../../shared/creativeEvidenceReview';
type Save=(name:string,value:unknown)=>Promise<unknown>;
/** 工作流语义精炼：字数只触发LLM处理，不截断文字、不降低本地schema容量。 */
export async function refineSunoSongStyles(candidate:unknown,target:SunoSongTarget,input:CreativeEvidenceReviewInput,draftModel:string,save:Save,refine=refineCreativeProposal){
 const original=parseSunoSongProposal(candidate,target);
 const result=await refine({...input,candidate:original,requirements:input.requirements+'\n本次只对三个brief.style做语义精炼，各目标850字符，尽量低于1000字符。保留三个编曲方向与全部音乐核心要求，删除重复措辞；其余字段逐字原样保留，包括歌词、标题、时长、演唱类型、negative_tags、两项风格参数、模板引用、观察区间。不要扩写或机械截断。审阅精炼后的真实文本。'},draftModel,(name,value)=>save('style-refinement-'+name,value));
 const proposal=parseSunoSongProposal(result.proposal,target);
 const withoutStyle=(value:typeof original)=>({...value,concepts:value.concepts.map(c=>({...c,brief:{...c.brief,style:''}}))});
 if(JSON.stringify(withoutStyle(original))!==JSON.stringify(withoutStyle(proposal)))throw Error('风格精炼改动了授权范围外的字段，原稿与模型回包已保留');
 await save('style-refinement-validated',{proposal,model:result.review.model,lengths:proposal.concepts.map(c=>c.brief.style.length)});
 return {...result,proposal};
}
