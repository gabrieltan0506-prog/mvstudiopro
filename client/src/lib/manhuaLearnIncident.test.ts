import {expect,it} from 'vitest';
import {manhuaLearnResultFromStart,manhuaLearnResultFromServerJob,mergeManhuaLearnServerJobsIntoBasket, type ManhuaLearnServerJobSnapshot} from './manhuaLearnResultUi';
const input={params:{url:'https://douyin.com/video/test-only',seriesKey:'s1',nativeDeepReadConfirmed:true}};
it('仍运行的缓存任务即使待学数为0也保留焦点与真实进度',()=>{
 const result=manhuaLearnResultFromStart({channel:'cloud',seriesKey:'s1'});
 const job:ManhuaLearnServerJobSnapshot={jobId:'j1',status:'running',input,output:{seriesKey:'s1',listedEpisodeCount:1,learnedCount:1,analysisStage:'manhua_learn_persist',analysisStageLabel:'7/11片',learnProgressLog:[{atIso:'2026-10-06T13:16:00Z',stage:'persist',detailZh:'7/11片'}]}};
 const basket=mergeManhuaLearnServerJobsIntoBasket([], [job]);
 expect(basket).toHaveLength(1);expect(basket[0].jobId).toBe('j1');expect(basket[0].result.pendingCount).toBe(0);
 expect(manhuaLearnResultFromServerJob(job,result)).toMatchObject({liveStatus:'running',liveLabelZh:'7/11片'});
 const failed={...job,status:'failed' as const,error:'确认计划不一致'};
 expect(mergeManhuaLearnServerJobsIntoBasket(basket,[failed])[0].result).toMatchObject({liveStatus:'failed',errorZh:'确认计划不一致'});
});
it('任务完成后即使不在待学篮子，焦点可从同一服务端回执得到终态',()=>{
 const base=manhuaLearnResultFromStart({channel:'cloud',seriesKey:'s1'});
 const result=manhuaLearnResultFromServerJob({jobId:'j1',status:'succeeded',input,output:{seriesKey:'s1',pipelineMode:'native_deep_read',batchLearned:1,learnedCount:1,listedEpisodeCount:1,pendingCount:0}},base);
 expect(result.liveStatus).toBe('succeeded');expect(result.pendingCount).toBe(0);
});
