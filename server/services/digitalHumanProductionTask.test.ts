import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const state = vi.hoisted(() => ({ rows: new Map<string, any>(), writes: 0, available: true }));
vi.mock("../db", () => ({ getDb: async () => state.available ? {
  insert: () => ({ values: (row: any) => ({ onConflictDoNothing: async () => { if (!state.rows.has(row.id)) { state.rows.set(row.id, structuredClone(row)); state.writes++; } } }) }),
  select: () => ({ from: () => ({ where: async (where: any) => { const [id, owner, type] = new PgDialect().sqlToQuery(where).params; const row = state.rows.get(String(id)); return row?.userId === owner && row?.type === type ? [row] : []; } }) }),
} : null }));
vi.mock("./postProdMediaSource", () => ({ resolvePostProdInputSources: async ({ input }: any) => input }));
import { digitalHumanProductionJobId, queueDigitalHumanProduction, getDigitalHumanProduction } from "./digitalHumanProductionTask";
const request = { requestId:"00000000-0000-4000-8000-000000000001",input:{action:"digital_human_continuity_frame" as const,params:{videoUri:"gs://test-only/post-prod/7/previous.mp4",atSec:12}}};
beforeEach(() => { state.rows.clear(); state.writes=0; state.available=true; });
it("并发同编号只插入一次，成功后恢复不重新排队", async () => {
  const [a,b]=await Promise.all([queueDigitalHumanProduction(7,request),queueDigitalHumanProduction(7,request)]);
  expect(a.jobId).toBe(b.jobId);expect(state.writes).toBe(1);
  state.rows.get(a.jobId).status="succeeded";
  expect((await queueDigitalHumanProduction(7,request)).status).toBe("succeeded");
  expect(state.writes).toBe(1);
});
it("同编号换参拒绝，原输入保留；不同账号不能读取",async()=>{
  const original=await queueDigitalHumanProduction(7,request);
  await expect(queueDigitalHumanProduction(7,{...request,input:{...request.input,params:{...request.input.params,atSec:13}}})).rejects.toThrow("另一份输入");
  expect(state.rows.get(original.jobId).input.params.atSec).toBe(12);
  expect(await getDigitalHumanProduction(8,request.requestId)).toBeNull();
  expect(digitalHumanProductionJobId(7,request.requestId)).not.toBe(digitalHumanProductionJobId(8,request.requestId));
  expect(await getDigitalHumanProduction(7,request.requestId)).toMatchObject({jobId:original.jobId,status:"queued"});
});
it("数据库不可用时不创建或假报空任务",async()=>{
  state.available=false;
  await expect(queueDigitalHumanProduction(7,request)).rejects.toThrow("未创建任务");
  await expect(getDigitalHumanProduction(7,request.requestId)).rejects.toThrow("不可用");
  expect(state.writes).toBe(0);
});
