import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('./jobs/knowledgeCardPageTask',async original=>({...await original<Record<string,unknown>>(),createKnowledgeCardPageJob:mocks.create}));
vi.mock('./services/gcs.js',async original=>({...await original<Record<string,unknown>>(),getGcsBucketName:()=> 'test-bucket'}));
import {appRouter} from './routers';
const caller=()=>appRouter.createCaller({user:{id:7,role:'user'}} as never);
const pageRequestId='12345678-1234-4234-8234-123456789abc';
beforeEach(()=>{mocks.create.mockReset();mocks.create.mockResolvedValue('test-job');});
it.each(['file','text'])('手册%s入口把JSON启用标识保存到worker任务',async kind=>{
 const result=await caller().mvAnalysis.prepareKnowledgeCardCopy({pageRequestId,billingPolicy:'interior-pages-v1',distillModel:'glm-5.3-flashx',detailLevel:'full',...(kind==='file'?{files:[{gcsUri:'gs://test-bucket/uploads/u7/source.epub',mimeType:'application/epub+zip'}]}:{sourceText:'真实文本知识与条件。'.repeat(40)})});
 expect(result).toMatchObject({isAsync:true,progressJobId:'test-job'});
 expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({userId:'7',action:'knowledge_card_distill',params:expect.objectContaining({billingPolicy:'interior-pages-v1',distillModel:'glm-5.3-flashx',chargeDistillFee:false})}));
});
it('旧卡片不被暗中切为手册JSON；跨用户原档仍拒绝',async()=>{
 await caller().mvAnalysis.prepareKnowledgeCardCopy({pageRequestId,sourceText:'原文'.repeat(150)});
 expect(mocks.create.mock.calls[0][0].params.billingPolicy).toBeUndefined();mocks.create.mockClear();
 await expect(caller().mvAnalysis.prepareKnowledgeCardCopy({pageRequestId,billingPolicy:'interior-pages-v1',files:[{gcsUri:'gs://test-bucket/uploads/u8/source.epub',mimeType:'application/epub+zip'}]})).rejects.toThrow('直传文件校验失败');expect(mocks.create).not.toHaveBeenCalled();
});
