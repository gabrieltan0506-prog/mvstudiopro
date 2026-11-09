import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  knowledgeSourceDigest,
  reviewKnowledgePublication,
} from "./knowledgePublicationAdvisor";
import { knowledgeBatchResultSchema } from "../../shared/knowledgePublication";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository";
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../jobs/repository", () => ({ getJobByIdStrict: vi.fn() }));
import { recoverKnowledgePublicationOperation } from "./knowledgePublicationRecovery";
import {
  manhuaAdvisorRequestFingerprint,
  MANHUA_ADVISOR_JOB_ACTION,
  MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,
} from "./manhuaAdvisorOperation";
import {
  KNOWLEDGE_PUBLICATION_ROUTE_VERSION,
  KNOWLEDGE_PUBLICATION_MODEL,
} from "./knowledgePublicationRoutes";
const uuid = "11111111-1111-4111-8111-111111111111";
function setup() {
  const context = { documentId: uuid, batchIndex: 0, attempt: 0 },
    input = {
      userId: 7,
      requestId: uuid,
      question: "整理",
      rawQuestion: "整理",
      qaModel: "gpt-5.6-terra",
      knowledgePublicationContext: context,
    };
  const source = {
      title: "原稿",
      pages: [{ id: uuid, headline: "原章", body: "完整正文", imageUrl: "" }],
    },
    sourceDigest = knowledgeSourceDigest(source);
  const report = {
    type: "knowledge_publication_v1",
    sourceDigest,
    title: "原稿",
    pages: [
      {
        id: uuid,
        headline: "原章",
        body: "完整正文",
        imageDescription: "",
        imageStatus: "absent",
        facts: [{ term: "原章", statement: "完整正文" }],
        cautions: [],
        reading: {
          version: 1,
          subtitle: "",
          accent: "jade",
          blocks: [
            { type: "prose", title: "原章", note: "", text: "完整正文" },
          ],
        },
      },
    ],
  };
  const request: any = {
    systemInstruction: { parts: [{ text: "整理" }] },
    contents: [
      {
        role: "user",
        parts: [{ text: JSON.stringify({ source, sourceDigest }) }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
    },
  };
  const digest = createHash("sha256")
    .update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION, request]))
    .digest("hex");
  const prefix = `knowledge-publications/user-7/${uuid}/${uuid}/batch-0`,
    route = `${prefix}/attempt-0/route-openrouter.json`;
  const store = new Map<string, any>([
    [
      route,
      {
        state: "failed",
        requestDigest: digest,
        response: {
          status: 200,
          text: JSON.stringify({
            model: KNOWLEDGE_PUBLICATION_MODEL,
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(report) },
              },
            ],
          }),
        },
      },
    ],
  ]);
  const job: any = {
    userId: "7",
    status: "failed",
    input: {
      action: MANHUA_ADVISOR_JOB_ACTION,
      requestId: uuid,
      requestFingerprint: manhuaAdvisorRequestFingerprint(input),
    },
    error: "旧失败",
    output: {
      action: MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,
      creditsRefunded: 12,
    },
  };
  const doc: any = {
    id: uuid,
    publication: { requestId: uuid, source, attempts: {}, completedBatches: 0 },
  };
  const billing = { charged: 12, settled: true };
  const deps: any = {
    job: vi.fn(async () => job),
    access: vi.fn(async () => doc),
    billing: vi.fn(async () => billing),
    read: vi.fn(async (k: string) => store.get(k) || null),
    save: vi.fn(async (k:string,v:any)=>{store.set(k,v);}),
    persist: vi.fn(async () => undefined),
    review: vi.fn(async (_u: any, _c: any, d: any) => {
      expect(await d.read(`${prefix}/report.json`)).toBeNull();
      expect(await d.read(`${prefix}/raw-0.json`)).toBeNull();
      const out = await d.post(request, {
        prefix: `${prefix}/attempt-0`,
        read: d.read,
        save: async (k: string, v: any) => {
          store.set(k, v);
        },
      });
      return JSON.parse(
        JSON.parse(out.text).candidates[0].content.parts[0].text
      );
    }),
  };
  return {
    input,
    deps,
    job,
    billing,
    store,
    route,
    prefix,
    doc,
    request,
    sourceDigest,
  };
}
const meta = { qaMode: "terra" as const, dailyLimit: 3, paidUnitCredits: 8 };
describe("正式出版失败事务恢复", () => {
  it("整册核对失败同样重验原回包并交回正式统稿，不依赖旧整册报告", async()=>{
    const f=setup();f.input.knowledgePublicationContext.batchIndex=1;
    f.job.input.requestFingerprint=manhuaAdvisorRequestFingerprint(f.input);
    const root=f.prefix.replace('/batch-0',''),prefix=root+'/consistency-0';
    const request:any={systemInstruction:{parts:[{text:'核对原事实'}]},contents:[{role:'user',parts:[{text:JSON.stringify({sourceDigest:f.sourceDigest,facts:[{pageId:uuid,headline:'原章',term:'原章',statement:'完整正文'}]})}]}],generationConfig:{temperature:0.2,maxOutputTokens:32768,responseMimeType:'application/json'}};
    const requestDigest=createHash('sha256').update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION,request])).digest('hex');
    const original=JSON.parse(JSON.parse(f.store.get(f.route).response.text).choices[0].message.content);original.kind='knowledge_publication_v1';delete original.type;original.pages[0].cautions=[{kind:'uncertain',evidence:'原文两处说法冲突',message:'已标注疑点，等待全册整理后统一联网核实。'}];
    f.store.set(f.prefix+'/report.json',{report:original,sourceImages:[]});
    f.store.set(root+'/report.json',{fake:'不能使用旧整册报告'});
    f.store.set(prefix+'/request-0.json',{sourceDigest:f.sourceDigest,request});
    f.store.set(prefix+'/attempt-0/route-openrouter.json',{state:'failed',requestDigest,response:{status:200,text:JSON.stringify({model:KNOWLEDGE_PUBLICATION_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify({type:'json_object',sourceDigest:f.sourceDigest,findings:[{pageIds:[uuid],evidence:'原文证据',message:'保留核对说明'}]})}}]})}});
    f.deps.review=(_u:any,_c:any,d:any)=>reviewKnowledgePublication(_u,_c,{...d,load:async()=>f.doc,save:d.save,count:async()=>({totalTokens:100,method:'test'})});
    const response=await recoverKnowledgePublicationOperation(f.input,meta,f.deps),review=JSON.parse(response!.answer);
    expect(review.kind).toBe('knowledge_publication_v1');expect(review.pages[0].cautions.some((c:any)=>c.message==='保留核对说明')).toBe(true);
    expect(response?.creditsCharged).toBe(0);expect(f.deps.persist).toHaveBeenCalledOnce();
    expect(f.store.get(root+'/report.json').report.pages).toEqual(review.pages);
  });

  it("正式审校函数重读原请求，批次返回可由出版面板合同消费", async () => {
    const f = setup();
    f.store.set(f.prefix + "/request-0.json", {
      sourceDigest: f.sourceDigest,
      request: f.request,
    });
    f.store.set(f.prefix + "/report.json", { fake: "禁止采用" });
    f.deps.review = (_u: any, _c: any, d: any) =>
      reviewKnowledgePublication(_u, _c, {
        ...d,
        load: async () => f.doc,
        save: async (k: string, v: any) => {
          f.store.set(k, v);
        },
        count: async () => ({ totalTokens: 100, method: "test" }),
      });
    const response = await recoverKnowledgePublicationOperation(
      f.input,
      meta,
      f.deps
    );
    const result = knowledgeBatchResultSchema.parse(
      JSON.parse(response!.answer)
    );
    expect(result.reviewedPages).toEqual([uuid]);
    expect(result.pages?.[0].body).toBe("### 原章\n\n完整正文");
    expect(f.store.get(f.prefix + "/report.json").report.pages[0].id).toBe(
      uuid
    );
    expect(f.deps.persist).toHaveBeenCalledOnce();
  });

  it.each(["saved", "same", "changed"])("正式持久化CAS：%s", async mode => {
    const f = setup();
    delete f.deps.persist;
    let saved: any;
    const returning = vi.fn(async () =>
      mode === "saved" ? [{ id: "original" }] : []
    );
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(value => {
      saved = value;
      return { where };
    });
    vi.mocked(getDb).mockResolvedValue({ update: () => ({ set }) } as any);
    vi.mocked(getJobByIdStrict).mockImplementation(
      async () =>
        ({
          status: "succeeded",
          output: {
            requestFingerprint: manhuaAdvisorRequestFingerprint(f.input),
            result: {
              answer: mode === "same" ? saved.output.result.answer : "other",
            },
          },
        }) as any
    );
    if (mode === "changed")
      await expect(
        recoverKnowledgePublicationOperation(f.input, meta, f.deps)
      ).rejects.toThrow("状态已变化");
    else
      expect(
        (await recoverKnowledgePublicationOperation(f.input, meta, f.deps))
          ?.success
      ).toBe(true);
    expect(saved.output.recovery.previousOutput).toEqual(f.job.output);
    expect(saved.output.recovery.billing).toEqual(f.billing);
    expect(saved.output.recovery.modelRequests).toBe(0);
    expect(returning).toHaveBeenCalledOnce();
  });

  it("重新解析原回包而不采用旁路报告，保留退款审计并零费用返回", async () => {
    const f = setup();
    f.store.set(f.prefix + "/report.json", { fake: "不得采用" });
    f.store.set(f.prefix + "/raw-0.json", { fake: "不得采用" });
    const result = await recoverKnowledgePublicationOperation(
      f.input,
      meta,
      f.deps
    );
    expect(result?.creditsCharged).toBe(0);
    expect(result?.replayed).toBe(true);
    expect(JSON.parse(result!.answer).pages[0].body).toContain("完整正文");
    expect(f.deps.persist).toHaveBeenCalledOnce();
    expect(f.deps.persist.mock.calls[0][4]).toBe(f.job);
    expect(f.deps.persist.mock.calls[0][5]).toBe(f.billing);
  });
  it.each(["owner", "request", "fingerprint", "action"])(
    "%s不符拒绝，不读模型回包",
    async field => {
      const f = setup();
      if (field === "owner") f.job.userId = "8";
      else
        f.job.input[
          field === "request"
            ? "requestId"
            : field === "fingerprint"
              ? "requestFingerprint"
              : "action"
        ] = "wrong";
      await expect(
        recoverKnowledgePublicationOperation(f.input, meta, f.deps)
      ).rejects.toThrow("身份");
      expect(f.deps.review).not.toHaveBeenCalled();
    }
  );
  it.each(["unsettled", "missing", "partial"])(
    "退款%s拒绝恢复",
    async state => {
      const f = setup();
      if (state === "unsettled") f.billing.settled = false;
      else if (state === "missing") delete f.job.output.creditsRefunded;
      else f.job.output.creditsRefunded = 1;
      await expect(
        recoverKnowledgePublicationOperation(f.input, meta, f.deps)
      ).rejects.toThrow("退款");
      expect(f.deps.review).not.toHaveBeenCalled();
    }
  );
  it.each(["missing", "invalid"])(
    "原回包%s不发新请求、不保存成功",
    async state => {
      const f = setup();
      if (state === "missing") f.store.clear();
      else
        f.store.get(f.route).response.text = JSON.stringify({
          model: KNOWLEDGE_PUBLICATION_MODEL,
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        });
      await expect(
        recoverKnowledgePublicationOperation(f.input, meta, f.deps)
      ).rejects.toThrow();
      expect(f.deps.persist).not.toHaveBeenCalled();
    }
  );
  it("从未发出的请求（无任何回执）在恢复入口按正式链首发，不再被零调用挡住（2026-11-09）", async () => {
    const f = setup();
    const original = f.store.get(f.route);
    for (const k of Array.from(f.store.keys())) if (k.includes("/route-") || k.endsWith("-response.json") || k.endsWith("/accepted.json")) f.store.delete(k);
    const answer = JSON.parse(JSON.stringify(f.store.get(f.route) ?? null));
    const fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      return new Response(JSON.stringify({ model, choices: [{ finish_reason: "stop", message: { content: JSON.parse(original.response.text).choices[0].message.content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    f.deps.routes = { key: () => "k", fetch, sign: () => "https://signed.invalid/x", thumbnail: async () => null } as any;
    // 断言放行：恢复入口确实按正式链发出了首个请求（不再抛「原回包不足以恢复，未提交新模型请求」）；回答合同由路由测试覆盖。
    await recoverKnowledgePublicationOperation(f.input, meta, f.deps).catch(error => { expect(String(error.message)).not.toContain("未提交新模型请求"); });
    expect(fetch).toHaveBeenCalled(); expect(answer).toBeNull();
    expect(JSON.stringify(Array.from(f.store.keys()))).toContain("/route-");
  });
  it("原回包unknown（断流）：等待窗内不发新请求；到期归档后只补买一次，再断即失败不保存成功", async () => {
    const f = setup();
    f.store.set(f.route, { requestDigest: f.store.get(f.route).requestDigest, state: "unknown", at: new Date().toISOString() });
    const fetch = vi.fn(async () => { throw Error("stream reset"); });
    // 等待窗内：sleep 被调用即说明在等迟到回执，不发新请求。
    f.deps.routes = { key: () => "k", fetch, sleep: vi.fn(async () => { throw Error("等待迟到回执中"); }) } as any;
    await expect(recoverKnowledgePublicationOperation(f.input, meta, f.deps)).rejects.toThrow("等待迟到回执中");
    expect(fetch).not.toHaveBeenCalled();
    // 到期：归档 interrupted，换通道补买一次；再断 → 章失败，不保存成功。
    f.deps.routes = { key: () => "k", fetch, sleep: vi.fn(async () => {}), lateReceiptWaitMs: 0 } as any;
    await expect(recoverKnowledgePublicationOperation(f.input, meta, f.deps)).rejects.toThrow("传输中断已发生两次");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.store.get(f.route).state).toBe("interrupted");
    expect(f.deps.persist).not.toHaveBeenCalled();
  });
  it("权限拒绝、运行中和退款待核均不能从此入口恢复", async () => {
    const f = setup();
    f.deps.access.mockRejectedValueOnce(Error("无权限"));
    await expect(
      recoverKnowledgePublicationOperation(f.input, meta, f.deps)
    ).rejects.toThrow("无权限");
    f.job.status = "running";
    expect(
      await recoverKnowledgePublicationOperation(f.input, meta, f.deps)
    ).toBeNull();
    f.job.status = "failed";
    f.job.output.action = "manhua_advisor_qa_refund_pending";
    expect(
      await recoverKnowledgePublicationOperation(f.input, meta, f.deps)
    ).toBeNull();
    expect(f.deps.review).not.toHaveBeenCalled();
  });
});
