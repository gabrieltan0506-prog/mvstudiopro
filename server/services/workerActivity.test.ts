import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recordWorkerActivity,readWorkerActivity,WORKER_QUIET_WINDOW_MS} from './workerActivity';
import {acquireWorkerProbeLease} from './workerProbeLease';
import {maybeStopIdleRig,type RigAutoscaleDeps} from '../jobs/rigAutoscale';
it('单次活动写入失败不污染后续队列，恢复后仍记录真实时间',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'activity-recovery-'));
 const mkdir=vi.spyOn(fs,'mkdir').mockRejectedValueOnce(Object.assign(new Error('测试临时空间不足'),{code:'ENOSPC'}));
 try{
  await expect(recordWorkerActivity('request',root,1000)).rejects.toThrow('测试临时空间不足');
  mkdir.mockRestore();
  await recordWorkerActivity('request',root,2000);
  expect(await readWorkerActivity(root)).toEqual({lastRequestAt:2000,lastProgressAt:0});
 }finally{mkdir.mockRestore();await fs.rm(root,{recursive:true,force:true});}
});
function fixture(){let now=600000;const stop=vi.fn(),abort=vi.fn();const activity={lastRequestAt:0,lastProgressAt:0};const deps:RigAutoscaleDeps={now:()=>now,queuedBlenderJobs:async()=>0,pendingBlenderJobs:async()=>0,workerActivity:async()=>activity,selfMachineId:'rig',idleStopMs:1000,listRig:async()=>[{id:'rig',state:'started',processGroup:'rig'}],startMachine:vi.fn(),stopMachine:stop,onStopAborted:abort,log:()=>{}};return {deps,activity,stop,abort,setNow:(v:number)=>{now=v}};}
it('请求和进度两个窗口必须都达到十分钟，旧短配置不能缩短',async()=>{const f=fixture();f.activity.lastRequestAt=1;expect((await maybeStopIdleRig(f.deps,{lastBusyAt:0},false)).action).toBe('waiting');f.activity.lastRequestAt=0;f.activity.lastProgressAt=1;expect((await maybeStopIdleRig(f.deps,{lastBusyAt:0},false)).action).toBe('waiting');expect(f.stop).not.toHaveBeenCalled();f.activity.lastProgressAt=0;expect((await maybeStopIdleRig(f.deps,{lastBusyAt:0},false)).action).toBe('stopped');expect(f.stop).toHaveBeenCalledTimes(1);});
it('关闸后新请求到达则取消停机；读取失败不误判空闲',async()=>{const f=fixture();f.deps.onStopDecided=()=>{f.activity.lastRequestAt=600000};expect((await maybeStopIdleRig(f.deps,{lastBusyAt:0},false)).action).toBe('waiting');expect(f.abort).toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();f.deps.workerActivity=async()=>{throw Error('unreadable')};expect((await maybeStopIdleRig(f.deps,{lastBusyAt:0},false)).action).toBe('error');expect(f.stop).not.toHaveBeenCalled();});
it('探针收尾后仍保留最近进度，新命令单独刷新请求时间',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'activity-'));try{let now=1000;const lease=await acquireWorkerProbeLease(root,()=>now);now=10000;await lease.renew();now=20000;await lease.release();const activity=path.join(root,'activity');expect(await readWorkerActivity(activity)).toEqual({lastRequestAt:1000,lastProgressAt:20000});await recordWorkerActivity('request',activity,30000);await recordWorkerActivity('request',activity,20000);expect(await readWorkerActivity(activity)).toEqual({lastRequestAt:30000,lastProgressAt:20000});expect(WORKER_QUIET_WINDOW_MS).toBe(600000);}finally{await fs.rm(root,{recursive:true,force:true})}});
