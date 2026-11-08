import { expect, it } from "vitest";
import { completedKnowledgeBatches, knowledgeCompletedPrefix, runKnowledgeParallelBatches, type KnowledgePublicationChannel } from "./knowledgePublicationParallel";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it("四路真实重叠且每通道两工位，快路补位，乱序完成不跳慢批次", async () => {
  const gates=Array.from({length:6},deferred),fifth=deferred();
  const started: [number, KnowledgePublicationChannel][] = [], completed = new Set<number>(), channels: Record<string, KnowledgePublicationChannel> = {};
  let active=0,maximum=0;const perChannel={openrouter:0,evolink:0},peaks={openrouter:0,evolink:0};
  // 固定四工位验证补位语义；默认工位数改为按批次数动态计算（见下一条）。
  const pending = runKnowledgeParallelBatches({ count: 6, completed, channels, active: () => true, lanes: ["openrouter","evolink","openrouter","evolink"], staggerMs: 0,
    assign: async (i, route) => { channels[i] = route; },
    execute: async (i, route) => {
      started.push([i, route]);maximum=Math.max(maximum,++active);peaks[route]=Math.max(peaks[route],++perChannel[route]);
      if(i===4)fifth.resolve();await gates[i].promise;active--;perChannel[route]--;return i;
    },
    complete: async i => { completed.add(i); },
  });
  await Promise.resolve(); await Promise.resolve();
  expect(started).toEqual([[0,"openrouter"],[1,"evolink"],[2,"openrouter"],[3,"evolink"]]);
  gates[1].resolve();await fifth.promise;
  expect(started[4]).toEqual([4,"evolink"]);expect(knowledgeCompletedPrefix(completed,6)).toBe(0);
  gates.forEach(g=>g.resolve());expect(await pending).toEqual([]);
  expect(maximum).toBe(4);expect(peaks).toEqual({openrouter:2,evolink:2});
  expect(Array.from(completed).sort()).toEqual([0,1,2,3,4,5]);expect(new Set(started.map(([i])=>i)).size).toBe(6);
});
it("单路失败保留另一条在途请求，恢复跳过乱序完成且保留原通道", async () => {
  const success = new Set<number>(), channels: Record<string, KnowledgePublicationChannel> = {};
  const calls: number[] = [];
  const errors = await runKnowledgeParallelBatches({ count: 4, completed: success, channels, active: () => true,
    assign: async (i, route) => { channels[i] = route; },
    execute: async i => { calls.push(i); if (i === 0) throw Error("回执未知"); return i; },
    complete: async i => { success.add(i); },
  });
  expect(errors.map(e => e.index)).toEqual([0]); expect(Array.from(success)).toEqual([1, 2, 3]);
  const replay: [number, KnowledgePublicationChannel][] = [];
  await runKnowledgeParallelBatches({ count: 4, completed: success, channels, active: () => true,
    assign: async () => {}, execute: async (i, route) => { replay.push([i, route]); return i; }, complete: async () => {},
  });
  expect(replay).toEqual([[0, "openrouter"]]); expect(calls.sort()).toEqual([0, 1, 2, 3]);
});
it("旧连续进度与新乱序集合合并，离开页面不领取新批次", async () => {
  expect(Array.from(completedKnowledgeBatches({ completedBatches: 2, parallel: { channels: {}, completed: [3] } }, 5))).toEqual([0, 1, 3]);
  let active = true; const calls: number[] = [];
  await runKnowledgeParallelBatches({ count: 4, completed: new Set(), channels: {}, active: () => active,
    assign: async () => { active = false; }, execute: async i => { calls.push(i); }, complete: async () => {},
  });
  expect(calls).toEqual([]);
});
it("慢图与读档准备不占通道，后到的快图立即审校", async () => {
  const slow = deferred(), text = deferred(), fast = deferred(), fastStarted = deferred();
  const calls:number[] = [], complete:number[] = [], channels:Record<string,KnowledgePublicationChannel> = {};
  const run=runKnowledgeParallelBatches({count:3,completed:new Set(),channels,active:()=>true,
    prepare:i=>[slow.promise,text.promise,fast.promise][i],
    assign:async(i,channel)=>{channels[i]=channel;},
    execute:async i=>{calls.push(i);if(i===2)fastStarted.resolve();return i;},
    complete:async i=>{complete.push(i);},
  });
  fast.resolve();await fastStarted.promise;
  expect(calls).toEqual([2]);expect(channels[0]).toBeUndefined();expect(channels[1]).toBeUndefined();
  text.resolve();slow.resolve();expect(await run).toEqual([]);
  expect(complete.sort()).toEqual([0,1,2]);
});
it("单张图准备失败不阻挡其他就绪批，也不为失败批分配付费通道",async()=>{
  const calls:number[]=[],assigned:number[]=[];
  const errors=await runKnowledgeParallelBatches({count:3,completed:new Set(),channels:{},active:()=>true,
    prepare:async i=>{if(i===0)throw Error("原图失败");},assign:async i=>{assigned.push(i);},
    execute:async i=>{calls.push(i);},complete:async()=>{},
  });
  expect(errors.map(e=>e.index)).toEqual([0]);expect((errors[0].error as Error).message).toBe("原图失败");
  expect(calls.sort()).toEqual([1,2]);expect(assigned.sort()).toEqual([1,2]);
});
it("就绪后恢复原通道，准备期间离开不会发出顾问请求",async()=>{
  const gate=deferred(),calls:number[]=[];let active=true;
  const run=runKnowledgeParallelBatches({count:1,completed:new Set(),channels:{0:"evolink"},active:()=>active,
    prepare:()=>gate.promise,assign:async()=>{},execute:async i=>{calls.push(i);},complete:async()=>{},
  });
  active=false;gate.resolve();expect(await run).toEqual([]);expect(calls).toEqual([]);
});

it("默认动态工位：16批一轮全部在途，OpenRouter份额更大，同通道错峰首发；限流只降该通道并发", async () => {
  const gates=Array.from({length:16},deferred);
  const started: [number, KnowledgePublicationChannel][] = [], channels: Record<string, KnowledgePublicationChannel> = {};
  const sleeps:number[]=[];
  const pending = runKnowledgeParallelBatches({ count: 16, completed: new Set(), channels, active: () => true,
    sleep: async ms => { sleeps.push(ms); },
    assign: async (i, route) => { channels[i] = route; },
    execute: async (i, route) => { started.push([i, route]); await gates[i].promise; return i; },
    complete: async () => {},
  });
  for(let k=0;k<20;k++)await Promise.resolve();
  expect(started).toHaveLength(16);
  const or=started.filter(([,c])=>c==="openrouter").length;
  expect(or).toBeGreaterThan(16-or);
  expect(sleeps.length).toBe(14);
  gates.forEach(g=>g.resolve());expect(await pending).toEqual([]);
});
