import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ submit: vi.fn(), list: vi.fn(), adopt: vi.fn(), adoptAndSave:vi.fn(), ensure: vi.fn() }));
vi.mock("../services/codeMotionSoundAdoption",()=>({adoptAndSaveCodeMotionSound:mock.adoptAndSave}));
vi.mock("../services/codeMotionSound", () => ({ submitCodeMotionSound: mock.submit, listCodeMotionSounds: mock.list, adoptCodeMotionSound: mock.adopt }));
vi.mock("../services/codeMotionProductionGrant", async original => ({ ...await original<typeof import("../services/codeMotionProductionGrant")>(), ensureCodeMotionProductionGrant: mock.ensure }));
import { codeMotionRouter } from "./codeMotion";
const projectId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", grantId = "33333333-3333-4333-8333-333333333333";
const ctx = { user: { id: 7, role: "user" }, req: { headers: {}, socket: { remoteAddress: "192.0.2.1" } }, res: {} } as any;
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("JWT_SECRET", "test-only-not-a-real-secret"); vi.stubEnv("FLY_APP_NAME", ""); mock.ensure.mockResolvedValue({ id: grantId }); });
afterEach(() => vi.unstubAllEnvs());
it("official sound router checks project grant before invoking the existing production service and preserves the original request identity", async () => {
  const api = codeMotionRouter.createCaller(ctx), request = { kind: "speech" as const, requestId, sceneIndex: 0, text: "欢迎来到树林", voice: "female" as const };
  const input = { projectId, generation: "4", request };
  await api.generateSound(input);
  expect(mock.ensure).toHaveBeenCalledWith("7", expect.objectContaining({ projectId, expectedGeneration: "4" }));
  expect(mock.submit).toHaveBeenCalledWith("7", projectId, "4", request, undefined, { grantId });
  expect(mock.ensure.mock.invocationCallOrder[0]).toBeLessThan(mock.submit.mock.invocationCallOrder[0]!);
  await api.generateSound(input); expect(mock.submit.mock.calls[1]).toEqual(mock.submit.mock.calls[0]);
  await api.sounds({ projectId }); expect(mock.list).toHaveBeenCalledWith("7", projectId);
  await api.adoptSound({ projectId, requestId, variantIndex: 0 }); expect(mock.adopt).toHaveBeenCalledWith("7", projectId, requestId, 0);
});
it("grant failure and absent authentication never reach a sound producer", async () => {
  mock.ensure.mockRejectedValue(Error("没有制作名额"));
  const input = { projectId, generation: "4", request: { kind: "bgm" as const, requestId, direction: "轻柔纯音乐" } };
  await expect(codeMotionRouter.createCaller(ctx).generateSound(input)).rejects.toThrow("没有制作名额");
  expect(mock.submit).not.toHaveBeenCalled();
  await expect(codeMotionRouter.createCaller({ ...ctx, user: null }).adoptSound({ projectId, requestId, variantIndex: 0 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(mock.adopt).not.toHaveBeenCalled();
});
it("official router accepts and preserves dialogue role, and rejects an invented audio role before reservation", async () => {
  const api = codeMotionRouter.createCaller(ctx);
  const request = {kind:"speech" as const,requestId,sceneIndex:1,text:"明天见",voice:"male" as const,role:"dialogue" as const};
  await api.generateSound({projectId,generation:"5",request});
  expect(mock.submit).toHaveBeenCalledWith("7",projectId,"5",request,undefined,{grantId});
  await expect(api.generateSound({projectId,generation:"5",request:{...request,role:"bgm" as any}})).rejects.toMatchObject({code:"BAD_REQUEST"});
  expect(mock.ensure).toHaveBeenCalledTimes(1);
  expect(mock.submit).toHaveBeenCalledTimes(1);
});
it("measured adoption router binds owner and saved generation while retaining the old source-only API",async()=>{
  const api=codeMotionRouter.createCaller(ctx);
  const input={projectId,requestId,variantIndex:0,expectedGeneration:"4"};
  await api.adoptSoundAndSave(input);
  expect(mock.adoptAndSave).toHaveBeenCalledWith("7",input);
  expect(mock.ensure).not.toHaveBeenCalled();
  await api.adoptSound({projectId,requestId,variantIndex:0});
  expect(mock.adopt).toHaveBeenCalledWith("7",projectId,requestId,0);
  await expect(codeMotionRouter.createCaller({...ctx,user:null}).adoptSoundAndSave(input)).rejects.toMatchObject({code:"UNAUTHORIZED"});
  expect(mock.adoptAndSave).toHaveBeenCalledTimes(1);
});
