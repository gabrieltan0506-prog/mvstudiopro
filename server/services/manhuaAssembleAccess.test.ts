import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { assertManhuaAssembleJobOwner, hasCurrentManhuaAssembleBillingContract, resolveManhuaAssembleAccess } from "./manhuaAssembleAccess.js";
import { MANHUA_ASSEMBLE_LEDGER_TYPE } from "./manhuaAssembleBilling.js";
import { CREDIT_COSTS } from "../plans.js";

const params = { billingContractVersion: "manhua-assemble-v1", clips: [{ clipUrl: "https://example.test/clip.mp4" }] };
const input = { action: "manhua_assemble_final", params };
const job = { id: "job-7", userId: "7", type: "video", status: "running", input };

function extract(file: string, predicate: (node: ts.Node) => boolean): string {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: ts.Node | undefined;
  function walk(node: ts.Node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, walk); }
  walk(tree);
  if (!found) throw new Error(`未找到真实入口：${file}`);
  return (found as ts.Node).getText(tree);
}

function runtime(code: string, deps: Record<string, unknown>, expression = true): any {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll("import(", "__import(");
  return new Function(...Object.keys(deps), expression ? `return ${js}` : js)(...Object.values(deps));
}

function response() {
  return { status: vi.fn(function (this: any, _status: number) { return this; }), json: vi.fn((body: unknown) => body) };
}

function queueRuntime(user: unknown) {
  const call = extract("../_core/index.ts", node => ts.isCallExpression(node) && node.expression.getText() === "app.all" && node.arguments[0]?.getText() === '"/api/jobs"');
  const tree = ts.createSourceFile("call.ts", call, ts.ScriptTarget.Latest, true);
  const callback = (tree.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
  const createJob = vi.fn(async () => {});
  const deps = {
    createContext: vi.fn(async () => ({ user })), createJob,
    resolveManhuaAssembleAccess, hasCurrentManhuaAssembleBillingContract,
    CREATIVE_NANO_IMAGE_ACTION: "creative_nano_image", nanoid: () => "job-7",
    processJobsOnce: vi.fn(async () => {}),
  };
  return { handle: runtime(`(${callback.arguments[1].getText(tree)})`, deps), ...deps };
}

describe("合成真实入口鉴权（执行源码，不发网络）", () => {
  it("只读能力握手在供应商配置读取前返回现价，POST拒绝且没有任何副作用", async () => {
    const source = readFileSync(new URL("../../api/jobs.ts", import.meta.url), "utf8");
    expect(source.indexOf('if (opNormalized === "manhuaassemblecapabilities")')).toBeLessThan(source.indexOf('const KLING_BASE ='));
    const branch = extract("../../api/jobs.ts", node => ts.isIfStatement(node) && node.expression.getText() === 'opNormalized === "manhuaassemblecapabilities"');
    const forbidden = vi.fn(() => { throw new Error("只读握手不得访问上游或账本"); });
    const handle = runtime(`(async (req, res) => { const opNormalized = "manhuaassemblecapabilities"; ${branch} })`, {
      CREDIT_COSTS, fail: (error: string) => ({ ok: false, error }),
      __import: forbidden, fetch: forbidden, resolveJobUser: forbidden,
    });
    const res = { ...response(), setHeader: vi.fn() };
    await handle({ method: "GET" }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, billingContractVersion: "manhua-assemble-v1", implicitMusic: false, finalRenderCredits: 5 });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    const post = { ...response(), setHeader: vi.fn() }; await handle({ method: "POST" }, post);
    expect(post.status).toHaveBeenCalledWith(405); expect(forbidden).not.toHaveBeenCalled();
  });
  it.each([undefined, null, { id: 0 }, { id: "public" }, { id: 1.5 }])("匿名或无效会话 %j 不入队", async user => {
    const q = queueRuntime(user);
    const res = response();
    await q.handle({ method: "POST", query: {}, body: { type: "video", input } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(q.createJob).not.toHaveBeenCalled();
    expect(q.processJobsOnce).not.toHaveBeenCalled();
  });

  it.each(["8", 7, { id: 7 }])("客户端伪造 userId %j 不入队", async userId => {
    const q = queueRuntime({ id: 7, openId: "openid-7" });
    const res = response();
    await q.handle({ method: "POST", query: {}, body: { type: "video", input, userId } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(q.createJob).not.toHaveBeenCalled();
  });

  it("本人 openId 只用于校验，持久化仍为会话数字 id", async () => {
    const q = queueRuntime({ id: 7, openId: "openid-7" });
    const res = response();
    await q.handle({ method: "POST", query: {}, body: { type: "video", input, userId: "openid-7" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(q.createJob).toHaveBeenCalledWith({ id: "job-7", userId: "7", type: "video", provider: "manhua-assemble", input });
  });

  it("旧页无新计费合同被挡在入队前，错误任务类型同样拒绝", async () => {
    for (const [type, paramsValue, status] of [["video", {}, 409], ["audio", params, 400]] as const) {
      const q = queueRuntime({ id: 7 }); const res = response();
      await q.handle({ method: "POST", query: {}, body: { type, input: { action: input.action, params: paramsValue } } }, res);
      expect(res.status).toHaveBeenCalledWith(status); expect(q.createJob).not.toHaveBeenCalled();
    }
  });

  it("旧同步入口匿名401、他人403、登录409；三者都不会运行渲染", async () => {
    const branch = extract("../../api/jobs.ts", node => ts.isIfStatement(node) && node.expression.getText() === 'opNormalized === "manhuaassemblefinal"');
    for (const [viewer, userId, status] of [[null, undefined, 401], [{ userId: 7 }, "8", 403], [{ userId: 7 }, undefined, 409]] as const) {
      const upstream = vi.fn(() => { throw new Error("不应加载渲染服务"); });
      const handle = runtime(`(async (req, res, b) => { const opNormalized = "manhuaassemblefinal"; ${branch} })`, {
        resolveJobUser: async () => viewer, resolveManhuaAssembleAccess,
        fail: (error: string, message?: string) => ({ ok: false, error, message }), __import: upstream,
      });
      const res = response(); await handle({ method: "POST" }, res, { userId });
      expect(res.status).toHaveBeenCalledWith(status); expect(upstream).not.toHaveBeenCalled();
    }
  });

  it("真实 worker 拒绝匿名、他人任务和未领取任务，拒绝前零账户/计费/渲染调用", async () => {
    const code = extract("../jobs/runner.ts", node => ts.isFunctionDeclaration(node) && node.name?.text === "processVideoJob");
    for (const [userId, persisted] of [["public", job], ["8", job], ["7", { ...job, status: "queued" }], ["7", { ...job, input: { ...input, params: {} } }]]) {
      const account = vi.fn(); const paid = vi.fn(); const render = vi.fn();
      const worker = runtime(`${code}\nreturn processVideoJob;`, {
        getJobByIdStrict: async () => persisted, assertManhuaAssembleJobOwner,
        resolveUserForJob: account, runPaidManhuaAssemble: paid,
        __import: async () => ({ createAssetAnalysisProgressReporter: () => ({}), runManhuaAssembleFinal: render }),
      }, false);
      await expect(worker(input, 1000, userId, "job-7")).rejects.toThrow();
      expect(account).not.toHaveBeenCalled(); expect(paid).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
    }
  });

  it("真实 worker 忽略 params 伪造身份并保留全部合成回执", async () => {
    const code = extract("../jobs/runner.ts", node => ts.isFunctionDeclaration(node) && node.name?.text === "processVideoJob");
    const rendered = { finalVideoUrl: "https://example.test/final.mp4", subtitleTimeline: { source: "real-timeline" } };
    const render = vi.fn(async () => rendered); const account = vi.fn(async () => ({ id: 7 }));
    const paid = vi.fn(async ({ run }) => run());
    const worker = runtime(`${code}\nreturn processVideoJob;`, {
      getJobByIdStrict: async () => job, assertManhuaAssembleJobOwner,
      resolveUserForJob: account, runPaidManhuaAssemble: paid,
      isRecord: (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value),
      __import: async () => ({ createAssetAnalysisProgressReporter: () => ({}), runManhuaAssembleFinal: render }),
    }, false);
    const result = await worker({ ...input, params: { ...params, userId: "88", role: "admin" } }, 1000, "7", "job-7");
    expect(account).toHaveBeenCalledWith("7");
    expect(paid).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, jobId: "job-7" }));
    expect(result.output).toEqual({ ...rendered, videoUrl: rendered.finalVideoUrl });
  });

  it.each(["success", "save_failed", "timeout", "settlement_pending"])("真实 worker 外层 %s 的落库／退款／无重排", async mode => {
    const code = extract("../jobs/runner.ts", node => ts.isFunctionDeclaration(node) && node.name?.text === "runClaimedJob");
    const timeoutCode = extract("../jobs/runner.ts", node => ts.isFunctionDeclaration(node) && node.name?.text === "withTimeout").replace(/^export\s+/, "");
    const record = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);
    const actualTimeout = runtime(`${timeoutCode}\nreturn withTimeout;`, { isRecord: record }, false);
    const ledger = {
      heartbeatActiveJob: vi.fn(async () => {}), refundCreditsOnFailure: vi.fn(async () => ({})),
      unregisterActiveJob: vi.fn(async () => {}), markSettlementPending: vi.fn(async () => true),
    };
    if (mode === "settlement_pending") ledger.unregisterActiveJob.mockRejectedValue(new Error("首次结算写入失败"));
    const output = { finalVideoUrl: "https://example.test/final.mp4", subtitleTimeline: { id: "timeline-7" } };
    const save = vi.fn(async () => mode !== "save_failed"); const failed = vi.fn(async () => {}); const requeue = vi.fn();
    const worker = runtime(`${code}\nreturn runClaimedJob;`, {
      isRecord: record, resolveJobTimeoutMs: () => 10, resolveJobGrowthInteractiveLeaseLabel: () => undefined,
      MANHUA_BGM_ACTION: "manhua_bgm", MANHUA_ASSEMBLE_LEDGER_TYPE,
      executeJob: () => mode === "timeout" ? new Promise(() => {}) : Promise.resolve({ output, provider: "manhua-assemble" }),
      withTimeout: (promise: Promise<unknown>, ms: number, message: string) => actualTimeout(promise, ms, message, { cleanupGraceMs: 0 }),
      markJobSucceededWithRetry: save, markJobFailed: failed, requeueJob: requeue,
      getJobFailureMessage: (_type: string, error: Error) => error.message,
      __import: async () => ledger,
    }, false);
    await worker(job);
    expect(requeue).not.toHaveBeenCalled();
    if (mode === "success" || mode === "settlement_pending") {
      expect(save).toHaveBeenCalledWith("job-7", output, "manhua-assemble");
      expect(save.mock.invocationCallOrder[0]).toBeLessThan(ledger.unregisterActiveJob.mock.invocationCallOrder[0]);
      expect(ledger.refundCreditsOnFailure).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
      if (mode === "settlement_pending") expect(ledger.markSettlementPending).toHaveBeenCalledWith("job-7", MANHUA_ASSEMBLE_LEDGER_TYPE);
    } else {
      expect(ledger.refundCreditsOnFailure).toHaveBeenCalledWith("job-7", MANHUA_ASSEMBLE_LEDGER_TYPE, "task_failed", expect.any(String));
      expect(failed).toHaveBeenCalledWith("job-7", expect.any(String));
      expect(ledger.unregisterActiveJob).not.toHaveBeenCalled();
      if (mode === "timeout") expect(save).not.toHaveBeenCalled();
    }
  });
});
