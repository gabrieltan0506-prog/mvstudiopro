import { afterEach, expect, it, vi } from "vitest";
const poll=vi.hoisted(()=>vi.fn());
vi.mock('./jobs',()=>({pollJobUntilTerminal:poll}));
import {withKnowledgeAdvisorRecovery} from './knowledgeAdvisorRecovery';
import {createHash} from 'node:crypto';
afterEach(()=>vi.clearAllMocks());
it('流中断后只查询同账号同请求，复用非空结果且不重复提交',async()=>{
 const execute=vi.fn(async()=>{throw Error('SSE断线');});
 poll.mockResolvedValue({status:'succeeded',output:{result:{success:true,answer:'完整章节和结尾',remainingFreeToday:0,creditsCharged:0}}});
 const result=await withKnowledgeAdvisorRecovery('same-id',execute,async()=>({id:7}),()=>true);
 expect(result.answer).toBe('完整章节和结尾');expect(result.replayed).toBe(true);expect(execute).toHaveBeenCalledTimes(1);
 expect(poll.mock.calls[0][0]).toBe('manhua_advisor_'+createHash('sha256').update('7:same-id').digest('hex').slice(0,40));
});
it('明确拒绝、换稿、未登录不进入恢复，失败与空回执不采用',async()=>{
 const run=()=>Promise.reject(Error('断线'));
 await expect(withKnowledgeAdvisorRecovery('id',()=>Promise.reject(Object.assign(Error('拒绝'),{advisorRejected:true})),async()=>({id:7}),()=>true)).rejects.toThrow('拒绝');
 await expect(withKnowledgeAdvisorRecovery('id',run,async()=>({id:7}),()=>false)).rejects.toThrow('离开');
 await expect(withKnowledgeAdvisorRecovery('id',run,async()=>null,()=>true)).rejects.toThrow('登录');expect(poll).not.toHaveBeenCalled();
 poll.mockResolvedValue({status:'failed',error:'原任务失败'});await expect(withKnowledgeAdvisorRecovery('id',run,async()=>({id:7}),()=>true)).rejects.toThrow('原任务失败');
 poll.mockResolvedValue({status:'succeeded',output:{result:{success:true,answer:''}}});await expect(withKnowledgeAdvisorRecovery('id',run,async()=>({id:7}),()=>true)).rejects.toThrow('不完整');
});
