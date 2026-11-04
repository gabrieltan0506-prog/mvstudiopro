import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireWorkerProbeLease, workerProbeLeasesBusy, WORKER_PROBE_LEASE_TTL_MS, assertWorkerProbeLease } from "./workerProbeLease";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for(const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true}); });
it("探针超过原10分钟持续心跳仍保护；正常释放立即解除；失联按TTL到期",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"probe-lease-")); roots.push(root);
 let now=1_000; const lease=await acquireWorkerProbeLease(root,()=>now);
 for(let i=0;i<40;i++){ now+=20_000;await lease.renew();expect(await workerProbeLeasesBusy(root,now)).toBe(true); }
 expect(await workerProbeLeasesBusy(root,now+WORKER_PROBE_LEASE_TTL_MS)).toBe(false);
 await lease.renew();expect(await workerProbeLeasesBusy(root,now)).toBe(true);
 await lease.release();expect(await workerProbeLeasesBusy(root,now)).toBe(false);
 await expect(lease.renew()).rejects.toThrow("已释放");
});
it("损坏租约拒绝误判空闲，已不存在的目录为空闲",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"probe-lease-"));roots.push(root);
 expect(await workerProbeLeasesBusy(path.join(root,"missing"))).toBe(false);
 await fs.writeFile(path.join(root,"broken.json"),"{}");
 await expect(workerProbeLeasesBusy(root)).rejects.toThrow("拒绝空闲停机");
});

it("付费探针必须有包装器有效租约，环境标记本身不足以放行",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"probe-guard-"));roots.push(root);vi.stubEnv("WORKER_PROBE_LEASE_DIR",root);vi.stubEnv("WORKER_PROBE_LEASE_ID","");
 await expect(assertWorkerProbeLease()).rejects.toThrow("包装器");
 const lease=await acquireWorkerProbeLease(root);vi.stubEnv("WORKER_PROBE_LEASE_ID",lease.id);
 await expect(assertWorkerProbeLease()).resolves.toBeUndefined();await lease.release();
 await expect(assertWorkerProbeLease()).rejects.toThrow();
});
it("真实停机忙检查消费探针租约，即使没有媒体子进程也判忙",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"probe-consumer-"));roots.push(root);vi.stubEnv("WORKER_PROBE_LEASE_DIR",root);
 const proc=path.join(root,"proc");await fs.mkdir(proc);
 const {workerMediaProcessesBusy}=await import("./workerMediaProcesses");
 const lease=await acquireWorkerProbeLease(root);
 expect(await workerMediaProcessesBusy(proc)).toBe(true);
 await lease.release();expect(await workerMediaProcessesBusy(proc)).toBe(false);
});
