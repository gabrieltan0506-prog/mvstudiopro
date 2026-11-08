import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), credits: vi.fn(), deduct: vi.fn(), image: vi.fn() }));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({ lookupKnowledgeCardDistillReceiptModel: mocks.lookup }));
vi.mock("./credits", async original => ({
  ...await original<Record<string, unknown>>(), getCredits: mocks.credits, deductCreditsAmount: mocks.deduct,
}));
vi.mock("./services/proxyImageService.js", async original => ({
  ...await original<Record<string, unknown>>(), generatePlatformCompositeSheetImage: mocks.image,
}));
import { appRouter } from "./routers";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createTRPCUntypedClient, httpLink, httpBatchLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { useLongTrpcHttpLink } from "../client/src/lib/trpcTransportRouting";
import { KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS, planKnowledgeCardPages } from '../shared/knowledgeCardPagination';

const caller = () => appRouter.createCaller({ user: { id: 7, role: "user" } } as never);
const base = {
  sceneId: "pricing-test", title: "水循环", scriptContext: "# 水循环\n\n蒸发后凝结成雨。",
  kind: "single_page_knowledge_card" as const, notePageIndex: 1, notePageTotal: 1,
  distillModel: "deepseek-v4.1-flash-1017", confirmedPageCredits: 30,
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.lookup.mockResolvedValue(null); mocks.credits.mockResolvedValue({ totalAvailable: 0 });
});
describe("手册真实API报价与扣费前门禁", () => {
  it("新价报价保留两档，旧账本覆盖客户端选档", async () => {
    expect(await caller().mvAnalysis.quoteKnowledgeCard({ markdown: base.scriptContext, distillModel: base.distillModel }))
      .toMatchObject({ pageCount: 1, credits: 30, billingModel: base.distillModel });
    expect(await caller().mvAnalysis.quoteKnowledgeCard({ markdown: base.scriptContext, distillModel: "glm-5.3-flashx" }))
      .toMatchObject({ credits: 34 });
    mocks.lookup.mockResolvedValue("glm-5.3-flash");
    expect(await caller().mvAnalysis.quoteKnowledgeCard({ markdown: base.scriptContext, distillModel: "glm-5.3-flashx" }))
      .toMatchObject({ credits: 24, billingModel: "glm-5.3-flash", hasReceipt: true });
  });
  it("未确认真实页价时零扣费、零模型调用", async () => {
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, confirmedPageCredits: 24 }))
      .rejects.toThrow("本页报价已变化或尚未确认");
    expect(mocks.credits).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("单页稿伪造第九页折扣时在扣费前拒绝", async () => {
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, notePageIndex: 9, notePageTotal: 9, confirmedPageCredits: 24 }))
      .rejects.toThrow("出图页码与当前稿件不一致");
    expect(mocks.credits).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("实际生成采用旧账本24积分，不接受客户端新价34", async () => {
    mocks.lookup.mockResolvedValue("glm-5.3-flash");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, distillModel: "glm-5.3-flashx", confirmedPageCredits: 34 }))
      .rejects.toThrow("本页报价已变化或尚未确认");
    await expect(caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, distillModel: "glm-5.3-flashx", confirmedPageCredits: 24 }))
      .rejects.toThrow("需要 24 点");
    expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
});

it("真实HTTP长中文报价通过POST到原服务，鉴权和全文保留且零扣费", async () => {
  const markdown = "# 长文报价\n" + "完整中文正文".repeat(11000);
  const calls: Array<{url:string;method:string;body:string;credentials:unknown}> = [];
  const server = createHTTPServer({ router: appRouter, createContext: async () => ({user:{id:7,role:"user"}} as never) });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("本地HTTP未就绪");
  const url = `http://127.0.0.1:${address.port}`;
  const fetcher:typeof fetch = async (input,init) => {
    calls.push({url:String(input),method:init?.method||"GET",body:String(init?.body||""),credentials:"include"});
    return fetch(input,{...init,credentials:"include"});
  };
  const client=createTRPCUntypedClient({links:[splitLink({condition:useLongTrpcHttpLink,
    true:httpLink({url,transformer:superjson,fetch:fetcher}),
    false:httpBatchLink({url:url+"/wrong-proxy",transformer:superjson,fetch:fetcher})})]});
  try {
    const expected = await caller().mvAnalysis.quoteKnowledgeCard({markdown,distillModel:base.distillModel});
    const actual = await client.mutation("mvAnalysis.quoteKnowledgeCardForGeneration",{markdown,distillModel:base.distillModel});
    expect(actual).toEqual(expected);
    expect(calls).toHaveLength(1);expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(url+"/mvAnalysis.quoteKnowledgeCardForGeneration");
    expect(superjson.parse(calls[0].body)).toEqual({markdown,distillModel:base.distillModel});
    expect(mocks.lookup).toHaveBeenLastCalledWith(7,markdown);
    expect(mocks.deduct).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();
  } finally { server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
},20000);

it("POST报价仍拒绝匿名和超长输入，不调用模型与扣费",async()=>{
  await expect(appRouter.createCaller({user:null} as never).mvAnalysis.quoteKnowledgeCardForGeneration({markdown:"正文"})).rejects.toThrow();
  await expect(caller().mvAnalysis.quoteKnowledgeCardForGeneration({markdown:"字".repeat(KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS+1)})).rejects.toThrow();
  expect(mocks.lookup).not.toHaveBeenCalled();expect(mocks.deduct).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();
});

it('五万以上手册原文到达真实分页及计费门禁，其他图片入口仍保持五万上限',async()=>{
 const markdown='# 长手册\n\n'+'保留原文与知识条件。'.repeat(5500);
 const plan=planKnowledgeCardPages(markdown,base.distillModel);
 expect(markdown.length).toBeGreaterThan(50000);expect(plan.pages.every(p=>p.length<=1200)).toBe(true);
 await expect(caller().mvAnalysis.generatePlatformCompositeSheet({...base,scriptContext:markdown,notePageTotal:plan.pageCount})).rejects.toThrow('需要 30 点');
 expect(mocks.lookup).toHaveBeenCalledWith(7,markdown);expect(mocks.credits).toHaveBeenCalled();
 mocks.lookup.mockClear();mocks.credits.mockClear();
 await expect(caller().mvAnalysis.generatePlatformCompositeSheet({...base,kind:'storyboard_sheet_landscape',scriptContext:markdown})).rejects.toThrow('50000');
 expect(mocks.lookup).not.toHaveBeenCalled();expect(mocks.credits).not.toHaveBeenCalled();expect(mocks.deduct).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();
});
