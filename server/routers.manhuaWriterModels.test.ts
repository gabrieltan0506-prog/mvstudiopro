import { beforeEach, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 60000 });
const modelCall = vi.hoisted(() => vi.fn());
const createCall = vi.hoisted(() => vi.fn(() => modelCall));
const charge = vi.hoisted(() => vi.fn());
const complete = vi.hoisted(() => vi.fn(() => true));
vi.mock("./services/manhuaWriterModelRun", () => ({ createManhuaWriterModelCall: createCall }));
vi.mock("./credits", async original => ({ ...await original<object>(), getCredits: async () => ({ totalAvailable: 100 }), deductCreditsAmount: charge }));
vi.mock("../shared/manhuaWriterRoom.js", async original => ({
  ...await original<object>(),
  parseManhuaWriterPack: () => ({ seriesTitle: "测试剧", episodes: [1,2,3].map(index => ({ index, title: "标题", body: "完整剧本正文".repeat(30), endHook: "下一集", sourceNotes: "底本与新增已区分" })) }),
  writerPackHasCompletePaidEpisodes: complete,
  writerPackLooksReady: () => true,
}));
const saveTrial = vi.hoisted(() => vi.fn());
vi.mock("./services/manhuaWriterTrial.js", async original => ({
  ...await original<object>(), countManhuaWriterTrialToday: async () => 0,
  findManhuaWriterTrialByChargeKey: async () => null, logManhuaWriterTrialUse: async () => {},
  deleteManhuaWriterTrialUse: async () => {}, saveManhuaWriterTrialResult: saveTrial,
}));
vi.mock("./services/manhuaViralTemplateStore.js", () => ({ resolveViralTemplateForExpand: async () => ({ card: { id: "private-template" }, appliedTemplate: { publicId: "mt_1e50", nameZh: "模板方法" } }) }));
vi.mock("../shared/manhuaViralTemplateBank.js", async original => ({ ...await original<object>(), formatManhuaViralTemplateWriterSkillFromCard: () => "已审核模板的节奏与呈现方法" }));
import { appRouter } from "./routers";
const caller = () => appRouter.createCaller({ user: { id: 7, role: "user" } } as never);
const input = { topic: "测试剧", requestId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff", episodeCount: 3, videoModel: "seedance-2.5" as const, model: "glm" as const, confirmedCredits: 18 };
beforeEach(() => {
  vi.clearAllMocks(); complete.mockReturnValue(true);
  modelCall.mockResolvedValue({ text: "完整剧本".repeat(40), model: "test" });
  charge.mockImplementation(async (_id, cost) => ({ cost, success: true }));
});
it.each(["glm", "deepseek"] as const)("%s三集18分，模型成功且正文完整后才扣", async model => {
  const result = await caller().mvAnalysis.expandManhuaWriterPack({ ...input, model });
  expect(createCall).toHaveBeenCalledWith(7, input.requestId, model);
  expect(charge).toHaveBeenCalledWith(7,18,"manhuaWriterExpand",expect.any(String),expect.objectContaining({ chargeKey: expect.any(String) }));
  expect(result).toMatchObject({ model, creditsCost: 18 });
  expect(modelCall.mock.invocationCallOrder[0]).toBeLessThan(charge.mock.invocationCallOrder[0]);
});
it("旧9分同意与没有模型的旧页在模型执行和扣款前拒绝", async () => {
  await expect(caller().mvAnalysis.expandManhuaWriterPack({ ...input, confirmedCredits: 9 })).rejects.toThrow("本次 18 积分");
  await expect(caller().mvAnalysis.expandManhuaWriterPack({ ...input, model: undefined })).rejects.toThrow("刷新后选择");
  expect(modelCall).not.toHaveBeenCalled();expect(charge).not.toHaveBeenCalled();
});
it("从第2集改写仅收2集12分，回执使用实际扣款额", async () => {
  charge.mockResolvedValueOnce({ cost: 0, success: true, source: "admin" });
  const result = await caller().mvAnalysis.expandManhuaWriterPack({ ...input, fromEpisode: 2, confirmedCredits: 12 });
  expect(charge.mock.calls[0][1]).toBe(12);expect(result.creditsCost).toBe(0);
});
it("空正文、模型失败及分集不完整都不扣款", async () => {
  modelCall.mockRejectedValueOnce(new Error("GLM：创作结果为空，旧稿保留"));
  await expect(caller().mvAnalysis.expandManhuaWriterPack(input)).rejects.toThrow("创作结果为空");
  complete.mockReturnValueOnce(false);
  await expect(caller().mvAnalysis.expandManhuaWriterPack(input)).rejects.toThrow("原稿未替换");
  expect(charge).not.toHaveBeenCalled();
});

it("免费两稿试写沿用所选DeepSeek并保存模型标识，不收正式扩写的6分", async () => {
  const text = "【单集梗概】他到医馆寻人，却发现名册上自己的名字被划去。\n【节拍点】\n1. 他推门问诊。\n2. 门后人藏起账本。\n3. 药童递出旧纸。\n【开场钩子】名单上怎么有我？";
  modelCall.mockResolvedValue({ text, model: "deepseek/deepseek-v4.1-flash" });
  const result = await caller().mvAnalysis.trialManhuaWriterTemplate({ topic: "测试剧", requestId: input.requestId, publicTemplateId: "mt_1e50", model: "deepseek" });
  expect(createCall).toHaveBeenCalledWith(7,input.requestId,"deepseek");
  expect(modelCall).toHaveBeenCalledTimes(2);
  expect(result.input.model).toBe("deepseek");
  expect(saveTrial).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ input: expect.objectContaining({ model: "deepseek" }) }) }));
  expect(charge).not.toHaveBeenCalled();
});

it("批次最少三集，旧两集请求在模型与扣款前拒绝", async () => {
  await expect(caller().mvAnalysis.expandManhuaWriterPack({ ...input, episodeCount: 2, confirmedCredits: 12 })).rejects.toThrow();
  expect(modelCall).not.toHaveBeenCalled(); expect(charge).not.toHaveBeenCalled();
});
