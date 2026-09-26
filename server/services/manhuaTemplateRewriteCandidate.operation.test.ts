/** 不访问真实模型或积分：以 jobs 状态桩验证重放、先存后扣、失败不扣。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  rows: new Map<string, Record<string, unknown>>(),
  failSuccessWrite: false,
}));
const model = vi.hoisted(() => vi.fn());
const deduct = vi.hoisted(() => vi.fn());

const fakeDb = {
  insert: () => ({ values: (value: Record<string, unknown>) => ({
    onConflictDoNothing: () => ({ returning: async () => {
      if (state.rows.has(String(value.id))) return [];
      state.row = { ...value, createdAt: new Date(), updatedAt: new Date(), output: null };
      state.rows.set(String(value.id), state.row);
      return [{ id: value.id }];
    } }),
  }) }),
  update: () => ({ set: (value: Record<string, unknown>) => ({ where: () => {
    const apply = () => {
      if (!state.row || (value.status === "succeeded" && state.failSuccessWrite)) return [];
      Object.assign(state.row, value);
      return [{ id: state.row.id }];
    };
    return { returning: async () => apply(), then: (resolve: (value: unknown) => void) => resolve(apply()) };
  } }) }),
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () =>
    Array.from(state.rows.values()).sort((a, b) => Number(b.createdAt) - Number(a.createdAt)),
  }) }) }) }),
};

vi.mock("../db.js", () => ({ getDb: async () => fakeDb }));
vi.mock("../jobs/repository.js", () => ({ getJobByIdStrict: async (id: string) => state.rows.get(id) || null }));
vi.mock("../credits.js", () => ({
  getCredits: async () => ({ totalAvailable: 20 }),
  deductCreditsAmount: (...args: unknown[]) => deduct(...args),
}));
vi.mock("./manhuaWriterExpandRun.js", () => ({ runManhuaWriterExpand: (...args: unknown[]) => model(...args) }));
vi.mock("./manhuaViralTemplateStore.js", () => ({ resolveViralTemplateForExpand: async (id: string) => ({
  card: { id: "secret" }, appliedTemplate: { publicId: id, nameZh: `匿名模板 ${id}` },
}) }));
vi.mock("../../shared/manhuaViralTemplateBank.js", () => ({
  formatManhuaViralTemplateWriterSkillFromCard: () => "审核模板完整提示词",
}));

import { generateManhuaTemplateCandidate, listManhuaTemplateCandidateHistory, sourceScriptSha256 } from "./manhuaTemplateRewriteCandidate.js";

const source = ("阿菁背着娘来到坊市。曹三：「留下马！」阿菁：「这是救命的马。」墨屠：「先挡住他。」娘：「先去医馆。」先生：「只剩三天。」墨屠：「取我的血。」").repeat(7);
const candidate = ("阿菁背着娘赶到坊市，墨屠忍伤随行。曹三：「把马留下！」阿菁：「它要救我娘的命。」墨屠：「我来挡他。」娘：「快去医馆。」先生：「药只够三天。」墨屠：「用我的血。」").repeat(8);
const input = {
  userId: 7,
  requestId: "d6e12535-225b-44f0-88d9-f59a5dfb4b6b",
  publicTemplateId: "mt_a349",
  episodeNumber: 1,
  sourceMarkdown: source,
  sourceSha256: sourceScriptSha256(source),
  confirmPaid: true,
};

beforeEach(() => {
  state.row = null;
  state.rows.clear();
  state.failSuccessWrite = false;
  model.mockReset().mockResolvedValue(candidate);
  deduct.mockReset().mockResolvedValue({ success: true, cost: 1, source: "personal" });
});

describe("付费候选操作状态", () => {
  it("合格候选先持久化再扣点；相同编号重放不重调模型、不重扣", async () => {
    deduct.mockImplementationOnce(async () => {
      expect((state.row?.output as { action: string }).action).toBe("manhua_template_script_candidate_ready");
      return { success: true, cost: 1, source: "personal" };
    });
    const first = await generateManhuaTemplateCandidate(input);
    expect(first.replayed).toBe(false);
    expect(first.candidateMarkdown).toBe(candidate);
    expect(first.creditsCost).toBe(1);
    expect(state.row?.status).toBe("succeeded");
    const second = await generateManhuaTemplateCandidate(input);
    expect(second.replayed).toBe(true);
    expect(second.candidateMarkdown).toBe(candidate);
    expect(model).toHaveBeenCalledTimes(1);
    expect(deduct).toHaveBeenCalledTimes(1);
  });

  it("同编号换原稿拒绝，且不执行第二次模型/扣点", async () => {
    await generateManhuaTemplateCandidate(input);
    const changed = source + "后续新镜头。";
    await expect(generateManhuaTemplateCandidate({
      ...input, sourceMarkdown: changed, sourceSha256: sourceScriptSha256(changed),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(model).toHaveBeenCalledTimes(1);
    expect(deduct).toHaveBeenCalledTimes(1);
  });

  it("同一原稿和模板即使换请求编号也复用已结算候选，不重复模型与扣点", async () => {
    const first = await generateManhuaTemplateCandidate(input);
    const second = await generateManhuaTemplateCandidate({ ...input,
      requestId: "17675570-a943-48c5-85e9-026f4321eab1",
    });
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.candidateMarkdown).toBe(first.candidateMarkdown);
    expect(second.replayed).toBe(true);
    expect(state.rows.size).toBe(1);
    expect(model).toHaveBeenCalledTimes(1);
    expect(deduct).toHaveBeenCalledTimes(1);
  });

  it("短候选拒收且不扣点", async () => {
    model.mockResolvedValue("只有梗概，暂无完整正文。".repeat(10));
    await expect(generateManhuaTemplateCandidate(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deduct).not.toHaveBeenCalled();
    expect(state.row?.status).toBe("failed");
  });

  it("未确认付费不建任务；明确未扣费失败后旧编号拒绝、新编号可再提交", async () => {
    await expect(generateManhuaTemplateCandidate({ ...input, confirmPaid: false }))
      .rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(state.rows.size).toBe(0);
    model.mockResolvedValueOnce("一段短梗概");
    await expect(generateManhuaTemplateCandidate(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const failedId = String(state.row?.id);
    expect(state.row?.status).toBe("failed");
    expect(deduct).not.toHaveBeenCalled();
    await expect(generateManhuaTemplateCandidate(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const retry = await generateManhuaTemplateCandidate({ ...input,
      requestId: "17675570-a943-48c5-85e9-026f4321eab1",
    });
    expect(retry.candidateMarkdown).toBe(candidate);
    expect(state.rows.size).toBe(1);
    expect(String(state.row?.id)).toBe(failedId);
    expect(deduct).toHaveBeenCalledTimes(1);
  });

  it("历史仅按登录用户、原稿 SHA、集次返回最多两张已结算匿名候选", async () => {
    await generateManhuaTemplateCandidate(input);
    const another = { ...input, requestId: "17675570-a943-48c5-85e9-026f4321eab1",
      publicTemplateId: "mt_4f93" };
    await generateManhuaTemplateCandidate(another);
    const foreign = { ...state.row, id: "foreign", userId: "999" };
    state.rows.set("foreign", foreign);
    const found = await listManhuaTemplateCandidateHistory({
      userId: 7, episodeNumber: 1, sourceSha256: input.sourceSha256,
    });
    expect(found.candidates).toHaveLength(2);
    expect(found.candidates.map((item) => item.publicTemplate.publicId).sort()).toEqual(["mt_4f93", "mt_a349"]);
    expect(found.candidates.every((item) => item.sourceSha256 === input.sourceSha256 && item.creditsCost === 1)).toBe(true);
    expect(found.candidates.every((item) => !("originalBody" in item))).toBe(true);
    expect((await listManhuaTemplateCandidateHistory({
      userId: 7, episodeNumber: 2, sourceSha256: input.sourceSha256,
    })).candidates).toHaveLength(0);
    expect((await listManhuaTemplateCandidateHistory({
      userId: 8, episodeNumber: 1, sourceSha256: input.sourceSha256,
    })).candidates).toHaveLength(0);
    expect((await listManhuaTemplateCandidateHistory({
      userId: 7, episodeNumber: 1, sourceSha256: "f".repeat(64),
    })).candidates).toHaveLength(0);
  });

  it("扣点成功但成功终态未写入时，同编号只结算已存候选", async () => {
    state.failSuccessWrite = true;
    await expect(generateManhuaTemplateCandidate(input)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((state.row?.output as { action: string }).action).toBe("manhua_template_script_candidate_ready");
    state.failSuccessWrite = false;
    deduct.mockResolvedValueOnce({ success: true, cost: 1, source: "personal", alreadyCharged: true });
    const retry = await generateManhuaTemplateCandidate(input);
    expect(retry.replayed).toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
    expect(deduct).toHaveBeenCalledTimes(2);
    expect(deduct.mock.calls[0]?.[4]).toEqual(deduct.mock.calls[1]?.[4]);
  });
});
