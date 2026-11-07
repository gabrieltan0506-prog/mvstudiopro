import {it,expect,vi} from 'vitest';
import {prepareKnowledgeCardEditions,KNOWLEDGE_EDITION_INSTRUCTIONS} from './knowledgeCardEditionPreparation';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';

it('新知识编排双通道同时发送，所有回包收齐后归并；两档同知识且恢复零调用',async()=>{
  const storage=new Map<string,any>();let active=0,peak=0;const channels:string[]=[];
  const invoke=vi.fn(async(request:any)=>{
    active++;peak=Math.max(peak,active);channels.push(request.executionChannel);
    await new Promise(resolve=>setTimeout(resolve,2));active--;
    if(request.researchOnly)return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({sourceDigest:"test",findings:[],verificationMarkdown:"无外部补充",sources:[]})}]}}]})};
    return {status:200,text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages:[{body:'# 测试知识\n\n## 主要重点｜先抓主线\n核心方法。\n\n## 次要重点｜细项用表说清\n具体条件与例子。'}]})}]}}]})};
  });
  const evidence={prefix:'test/edition',read:async(k:string)=>storage.get(k)||null,save:async(k:string,v:any)=>{storage.set(k,v);}};
  const sourceMarkdown=Array.from({length:6},(_,i)=>`## 原始主题${i}\n${'原始资料，不冒充真实模型验证。'.repeat(700)}`).join('\n\n');
  const result=await prepareKnowledgeCardEditions({sourceMarkdown,evidence,measure:async()=>1,invoke:invoke as any});
  expect(peak).toBeGreaterThan(1);expect(channels).toContain('openrouter');expect(channels).toContain('evolink');
  expect(knowledgeEditionParts(result.markdown)!.knowledge).toBe(knowledgeEditionParts(result.fullEditionMarkdown)!.knowledge);
  expect(knowledgeEditionParts(result.markdown)!.reading).toContain('具体条件');
  const count=invoke.mock.calls.length;await prepareKnowledgeCardEditions({sourceMarkdown,evidence,measure:async()=>1,invoke:invoke as any});
  expect(invoke).toHaveBeenCalledTimes(count);expect(storage.get('test/edition/editions.json').original).toBe(sourceMarkdown);
  await expect(prepareKnowledgeCardEditions({sourceMarkdown:sourceMarkdown+'改稿',evidence,measure:async()=>1,invoke:invoke as any})).rejects.toThrow('版本变化');
  expect(invoke).toHaveBeenCalledTimes(count);
  expect(KNOWLEDGE_EDITION_INSTRUCTIONS).toContain('适度幽默');expect(KNOWLEDGE_EDITION_INSTRUCTIONS).toContain('不输出JSON');
});
