import { describe, expect, it, vi } from "vitest";
import { completedKnowledgeBatches, knowledgeCoalescedUpdater, knowledgeCompletedPrefix, runKnowledgeParallelBatches, type KnowledgePublicationChannel } from "./knowledgePublicationParallel";
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
  expect(replay).toEqual([[0, "evolink"]]); expect(calls.sort()).toEqual([0, 1, 2, 3]);
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

it("默认动态工位：16批一轮全部在途，EvoLink份额更大（2026-11-09 用户规则 EvoLink 优先），同通道错峰首发；限流只降该通道并发", async () => {
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
  const evo=started.filter(([,c])=>c==="evolink").length;
  expect(evo).toBeGreaterThan(16-evo);
  expect(started[0][1]).toBe("evolink");
  expect(sleeps.length).toBe(14);
  gates.forEach(g=>g.resolve());expect(await pending).toEqual([]);
});

describe("合并保存发车（1110 实测：每批固定通道单独整库保存约 10 秒，34 批发车 6 分钟）", () => {
  it("34 批：通道固定合并成少数几次保存，按通道上限一次发满，1 分钟内全部发出", async () => {
    vi.useFakeTimers();
    try {
      const SAVE_MS = 10_000, BATCH_MS = 90_000;
      let saves = 0, persisted: Record<string, KnowledgePublicationChannel> = {};
      const pinned: Record<string, KnowledgePublicationChannel> = {};
      const update = knowledgeCoalescedUpdater({ save: async () => { saves++; const snapshot = { ...pinned }; await new Promise(r => setTimeout(r, SAVE_MS)); persisted = snapshot; } });
      const sentAt: number[] = [], start = Date.now();
      const run = runKnowledgeParallelBatches({ count: 34, completed: new Set(), channels: pinned, active: () => true,
        assign: (i, channel) => update(() => { pinned[i] = channel; }),
        execute: async (i, channel) => {
          // 发出前通道必须已在云稿落盘。
          expect(persisted[i]).toBe(channel);
          sentAt.push(Date.now() - start);
          await new Promise(r => setTimeout(r, BATCH_MS));
          return i;
        },
        complete: (i) => update(() => undefined),
      });
      await vi.advanceTimersByTimeAsync(60_000);
      // 32 工位（每通道上限 16）在 1 分钟内全部发出；余下 2 批等首批收妥后补位。
      expect(sentAt.length).toBe(32);
      expect(Math.max(...sentAt)).toBeLessThan(20_000);
      expect(saves).toBeLessThanOrEqual(2);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(await run).toEqual([]);
      expect(sentAt.length).toBe(34);
      // 收尾 34 次回执也合并保存，而不是 34 次串行。
      expect(saves).toBeLessThan(12);
    } finally { vi.useRealTimers(); }
  });
  it("单个改动抛错只拒绝自己；保存失败拒绝同批改动；离开页面不保存", async () => {
    let fail = false, saves = 0, here = true;
    const update = knowledgeCoalescedUpdater({ guard: () => { if (!here) throw Error("已离开"); }, save: async () => { saves++; if (fail) throw Error("保存失败"); } });
    const results = await Promise.allSettled([update(() => undefined), update(() => { throw Error("坏回执"); }), update(() => undefined)]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(saves).toBe(1);
    fail = true;
    const failed = await Promise.allSettled([update(() => undefined), update(() => undefined)]);
    expect(failed.every(r => r.status === "rejected")).toBe(true);
    fail = false; here = false;
    await expect(update(() => undefined)).rejects.toThrow("已离开");
    expect(saves).toBe(2);
  });
});
