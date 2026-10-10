import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  analyze: vi.fn(), prepare: vi.fn(), submit: vi.fn(), list: vi.fn(), adopt: vi.fn(),
  ensureGrant: vi.fn(), prepareGrant: vi.fn(), getGrant: vi.fn(),
}));
vi.mock("../services/codeMotionImageSemantic",()=>({analyzeCodeMotionImageSemantic:mock.analyze}));
vi.mock("../services/codeMotionImages", () => ({
  prepareCodeMotionImages: mock.prepare, submitCodeMotionImages: mock.submit,
  listCodeMotionImages: mock.list, adoptCodeMotionImage: mock.adopt,
}));
vi.mock("../services/codeMotionProductionGrant", async original => ({
  ...await original<typeof import("../services/codeMotionProductionGrant")>(),
  ensureCodeMotionProductionGrant: mock.ensureGrant,
  prepareCodeMotionProductionGrant: mock.prepareGrant,
  getCodeMotionProductionGrant: mock.getGrant,
}));
import { codeMotionRouter } from "./codeMotion";
const projectId = "11111111-1111-4111-8111-111111111111", grantId = "22222222-2222-4222-8222-222222222222";
const ctx = { user: { id: 7, role: "user" }, req: { headers: {}, socket: { remoteAddress: "192.0.2.1" }, ip: "192.0.2.1" }, res: {} } as any;
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.stubEnv("JWT_SECRET", "test-only-not-a-real-secret"); vi.stubEnv("FLY_APP_NAME", ""); vi.resetAllMocks(); mock.prepareGrant.mockResolvedValue({ id: grantId }); mock.ensureGrant.mockResolvedValue({ id: grantId }); mock.getGrant.mockResolvedValue(null); });
it("official protected router isolates account and does not consume a production grant while showing reviewed image content", async () => {
  const api = codeMotionRouter.createCaller(ctx);
  mock.prepare.mockResolvedValue({ fingerprint: "a".repeat(64), shots: [], credits: 0 });
  await api.imagePrepare({ projectId, expectedGeneration: "3" });
  expect(mock.prepareGrant).toHaveBeenCalledWith("7", { projectId, expectedGeneration: "3" });
  expect(mock.prepare).toHaveBeenCalledWith("7", { projectId, expectedGeneration: "3", grantId });
  expect(mock.ensureGrant).not.toHaveBeenCalled();
  await api.imageList({ projectId }); expect(mock.list).toHaveBeenCalledWith("7", projectId);
  await api.imageAdopt({ projectId, grantId, index: 2 }); expect(mock.adopt).toHaveBeenCalledWith("7", { projectId, grantId, index: 2 });
  await expect(codeMotionRouter.createCaller({ ...ctx, user: null }).imagePrepare({ projectId, expectedGeneration: "3" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
it("official submit reserves only after confirmation; restored batch does not reserve or charge a second grant", async () => {
  const api = codeMotionRouter.createCaller(ctx), input = { projectId, expectedGeneration: "3", grantId, fingerprint: "a".repeat(64) };
  await api.imageSubmit(input);
  expect(mock.ensureGrant).toHaveBeenCalledTimes(1);
  expect(mock.ensureGrant).toHaveBeenCalledWith("7", expect.objectContaining({ ...input, source: expect.objectContaining({ ipHash: expect.any(String) }) }));
  expect(mock.submit).toHaveBeenCalledWith("7", input);
  mock.getGrant.mockResolvedValue({ id: grantId });
  await api.imageSubmit(input); expect(mock.ensureGrant).toHaveBeenCalledTimes(1);
  await expect(api.imageAdopt({ projectId, grantId, index: 6 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("confirmed semantic router binds owner, saved generation and grant, then rebuilds the reviewed image content",async()=>{
 const api=codeMotionRouter.createCaller(ctx),input={projectId,expectedGeneration:"3",grantId};
 mock.prepare.mockResolvedValue({shots:[{mode:"edit"}],fingerprint:"b".repeat(64)});
 const result=await api.imageAnalyze(input);
 expect(mock.analyze).toHaveBeenCalledWith("7",input);expect(mock.prepare).toHaveBeenCalledWith("7",input);expect(result.shots[0].mode).toBe("edit");
 mock.ensureGrant.mockResolvedValue({id:"99999999-9999-4999-8999-999999999999"});
 await expect(api.imageAnalyze(input)).rejects.toMatchObject({code:"CONFLICT"});expect(mock.analyze).toHaveBeenCalledTimes(1);
 await expect(codeMotionRouter.createCaller({...ctx,user:null}).imageAnalyze(input)).rejects.toMatchObject({code:"UNAUTHORIZED"});
});
