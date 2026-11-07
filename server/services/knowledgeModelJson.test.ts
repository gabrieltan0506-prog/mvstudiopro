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
it('只剥完整对象后的多余闭合符号，不丢弃后续对象或正文',()=>{
 expect(parseKnowledgeModelJson('{"text":"原文"}]}').value).toEqual({text:'原文'});
 for(const raw of ['{"text":"原文"}{"text":"另一段"}','{"text":"原文"}尾部正文'])
  expect(()=>parseKnowledgeModelJson(raw)).toThrow(KnowledgeJsonSyntaxError);
});
it('完整JSON末项已闭合但page对象少一个结束括号时无损恢复',()=>{
 const raw='{"pages":[{"body":"原句与数字12.5完整保留","reading":{"blocks":[{"text":"完整内容"}],"design":{"reason":"完整理由"}}]}';
 const out=parseKnowledgeModelJson(raw);
 expect(out.value).toEqual({pages:[{body:'原句与数字12.5完整保留',reading:{blocks:[{text:'完整内容'}],design:{reason:'完整理由'}}}]});
 expect(out.repairs).toEqual([expect.objectContaining({removed:'',inserted:'}'})]);
});
