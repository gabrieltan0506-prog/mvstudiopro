import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const calls = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("../services/stockFootage/keywords", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/stockFootage/keywords")>()),
  suggestStockKeywords: calls.suggest,
}));
import { clearStockKeywordCache } from "../services/stockFootage/keywords";
import { stockFootageRouter } from "./stockFootage";

const caller = (id?: number) => stockFootageRouter.createCaller({ user: id ? { id, role: "user" } : null } as TrpcContext);
const input = { text: "夕阳下的海边", purpose: "mv" as const };

beforeEach(() => {
  vi.clearAllMocks();
  clearStockKeywordCache();
});

describe("stockFootage.suggestKeywords 路由", () => {
  it("未登录拒绝（反向）", async () => {
    await expect(caller().suggestKeywords(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls.suggest).not.toHaveBeenCalled();
  });

  it("正向：输入裁剪后透传，输出原样返回", async () => {
    calls.suggest.mockResolvedValue({ query: "beach sunset", queryZh: "海边 日落", source: "llm" });
    const r = await caller(7).suggestKeywords({ text: "  夕阳下的海边 ", purpose: "mv", orientation: "portrait" });
    expect(r).toEqual({ query: "beach sunset", queryZh: "海边 日落", source: "llm" });
    expect(calls.suggest).toHaveBeenCalledWith({ text: "夕阳下的海边", purpose: "mv", orientation: "portrait" });
  });

  it.each([
    ["空文本", { text: "  ", purpose: "mv" }],
    ["超长文本", { text: "海".repeat(1001), purpose: "mv" }],
    ["未知用途", { text: "海边", purpose: "ads" }],
    ["未知画幅", { text: "海边", purpose: "mv", orientation: "wide" }],
    ["多余字段", { text: "海边", purpose: "mv", userId: 8 }],
  ])("输入校验（反向：%s）→ BAD_REQUEST", async (_name, bad) => {
    await expect(caller(7).suggestKeywords(bad as typeof input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.suggest).not.toHaveBeenCalled();
  });

  it("每用户每分钟超过 30 次 → TOO_MANY_REQUESTS，其他用户不受影响", async () => {
    calls.suggest.mockResolvedValue({ query: "beach sunset", queryZh: "海边 日落", source: "rules" });
    for (let i = 0; i < 30; i++) await caller(9).suggestKeywords(input);
    await expect(caller(9).suggestKeywords(input)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "操作太频繁，请稍后再试" });
    await expect(caller(10).suggestKeywords(input)).resolves.toMatchObject({ source: "rules" });
  });

  it("内部异常走 safely 统一映射，不透出内部细节", async () => {
    calls.suggest.mockRejectedValue(new Error("internal upstream detail"));
    await expect(caller(7).suggestKeywords(input)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "素材服务暂不可用，请稍后再试" });
  });
});
