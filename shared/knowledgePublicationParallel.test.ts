import { expect, it } from "vitest";
import { completedKnowledgeBatches, knowledgeCompletedPrefix, runKnowledgeParallelBatches, type KnowledgePublicationChannel } from "./knowledgePublicationParallel";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it("两路真实重叠，快路立即补位，乱序完成不跳过慢批次", async () => {
  const slow = deferred(), fast = deferred(), third = deferred();
  const started: [number, KnowledgePublicationChannel][] = [], completed = new Set<number>(), channels: Record<string, KnowledgePublicationChannel> = {};
  const pending = runKnowledgeParallelBatches({ count: 4, completed, channels, active: () => true,
    assign: async (i, route) => { channels[i] = route; },
    execute: async (i, route) => { started.push([i, route]); if (i === 0) await slow.promise; if (i === 1) await fast.promise; if (i === 2) third.resolve(); return i; },
    complete: async i => { completed.add(i); },
  });
  await Promise.resolve(); await Promise.resolve();
  expect(started).toEqual([[0, "openrouter"], [1, "evolink"]]);
  fast.resolve(); await third.promise;
  expect(started[2]).toEqual([2, "evolink"]);
  expect(knowledgeCompletedPrefix(completed, 4)).toBe(0);
  slow.resolve(); expect(await pending).toEqual([]);
  expect(Array.from(completed).sort()).toEqual([0, 1, 2, 3]);
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
