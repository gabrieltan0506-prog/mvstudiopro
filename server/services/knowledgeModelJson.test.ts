import {expect,it} from 'vitest';
import {parseKnowledgeModelJson,KnowledgeJsonSyntaxError} from './knowledgeModelJson';

it('仅补完整容器之间的逗号，中文、引号和字段值保持原样',()=>{
 const raw='{"pages":[{"body":"原文\\\"引号\\\""} {"body":"末句不丢"}],"reading":{"blocks":[] "title":"正文"}}';
 const out=parseKnowledgeModelJson(raw);
 expect(out.repairs).toHaveLength(2);
 expect(out.value).toEqual({pages:[{body:'原文"引号"'},{body:'末句不丢'}],reading:{blocks:[],title:'正文'}});
});
it.each(['{"body":"未结束', '{"body":"未转义的"引号"}', '{"reading":{"blocks":[]},{"id":"下一章"}}', '[1,,]', '[,]', '{"body":'])('不补丢失正文、值或有歧义的结构：%s',raw=>{
 expect(()=>parseKnowledgeModelJson(raw)).toThrow(KnowledgeJsonSyntaxError);
});
it.each([
 ['{"pages":[{"body":"原文"}',{pages:[{body:'原文'}]}],
 ['["正文" "另一段"]',['正文','另一段']],
 ['{"body":"第一行\n第二行\t缩进"}',{body:'第一行\n第二行\t缩进'}],
 ['{"blocks":[{"text":"原文"},],}',{blocks:[{text:'原文'}]}],
 ['{"body"："中文，标点不变"，"blocks":[]}',{body:'中文，标点不变',blocks:[]}],
 ['```json\n{"body":"完整正文"}\n```',{body:'完整正文'}],
])('修复结构标点后正文保持原值：%s',(raw,expected)=>{
 const result=parseKnowledgeModelJson(raw as string);expect(result.value).toEqual(expected);expect(result.repairs.length).toBeGreaterThan(0);
});
it('合法JSON不改写',()=>{
 expect(parseKnowledgeModelJson('{"text":"数组 ],[ 只是正文","value":4.2}')).toEqual({value:{text:'数组 ],[ 只是正文',value:4.2},repairs:[]});
});
