import {expect,it} from 'vitest';
import {parseKnowledgeModelJson,KnowledgeJsonSyntaxError} from './knowledgeModelJson';

it('仅补完整容器之间的逗号，中文、引号和字段值保持原样',()=>{
 const raw='{"pages":[{"body":"原文\\\"引号\\\""} {"body":"末句不丢"}],"reading":{"blocks":[] "title":"正文"}}';
 const out=parseKnowledgeModelJson(raw);
 expect(out.repairs).toHaveLength(2);
 expect(out.value).toEqual({pages:[{body:'原文"引号"'},{body:'末句不丢'}],reading:{blocks:[],title:'正文'}});
});
it.each(['{"body":"未结束', '{"a":"x"b":1}', '{"reading":{"blocks":[]},{"id":"下一章"}}', '[1,,]', '[,]', '{"body":'])('不补丢失正文、值或有歧义的结构：%s',raw=>{
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

it('字符串内未转义的英文双引号逐颗转义，正文逐字保留；缺逗号的相邻键不受影响',()=>{
 const raw='{"pages":[{"body":"作者说"每天走一万步"即可，"并非"医嘱","n":1}],"k":"v"}';
 const {value,repairs}=parseKnowledgeModelJson(raw) as any;
 expect(value.pages[0].body).toBe('作者说"每天走一万步"即可，"并非"医嘱');expect(value.k).toBe('v');
 expect(repairs.every((r:any)=>r.inserted==='\\"')).toBe(true);
 const gap=parseKnowledgeModelJson('{"a":"x" "b":1}') as any;
 expect(gap.value).toEqual({a:'x',b:1});
});

it('2026-11-08 血脂本真实阻断：字符串内未转义引号可无损转义（旧规则视为歧义拒收，导致整批审校失败）',()=>{
 expect((parseKnowledgeModelJson('{"body":"未转义的"引号"}') as any).value).toEqual({body:'未转义的"引号'});
});

it('2026-11-08 真实回包：空字符串值后多出无键的 :"" 片段可删除，正文不丢；非空多余值仍拒收',()=>{
 const raw='{"blocks":[{"type":"cards","title":"表中自带的边界提示","note":"":"","items":[{"title":"苦瓜+带鱼","body":"“护肝”为传统说法。"}]}]}';
 const {value,repairs}=parseKnowledgeModelJson(raw) as any;
 expect(value.blocks[0].note).toBe('');expect(value.blocks[0].items[0].body).toBe('“护肝”为传统说法。');
 expect(repairs).toHaveLength(1);
 expect(()=>parseKnowledgeModelJson('{"note":"":"有内容","items":[]}')).toThrow(KnowledgeJsonSyntaxError);
});

it('2026-11-08 排版真实回包：数组中对象元素少一个结束括号后紧接下一元素，补齐结构不改正文',()=>{
 const raw='{"chapters":[{"pageId":"a","presentation":{"reading":{"blocks":[{"type":"prose","text":"喝奶属于日常饮食安排。"}]}},{"pageId":"b","design":{"palette":"ink-cinnabar"}}]}';
 const {value,repairs}=parseKnowledgeModelJson(raw) as any;
 expect(value.chapters).toHaveLength(2);expect(value.chapters[0].presentation.reading.blocks[0].text).toBe('喝奶属于日常饮食安排。');
 expect(value.chapters[1].pageId).toBe('b');expect(repairs).toHaveLength(1);
});
