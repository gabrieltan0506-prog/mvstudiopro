/**
 * 真实组件回归的挂载入口：挂真的 PlatformPage，所有 tRPC / job 轮询走本地桩，绝不连生产。
 * 只被 knowledgeCardDeriveInterlock.browser.test.ts 用 esbuild 打包，不进生产包。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import PlatformPage from "@/pages/PlatformPage";

const FULL = ["# 财务自由完整版", ...Array.from({ length: 40 }, (_, i) =>
  `\n## 完整版第 ${i + 1} 节：现金流与负债\n- 先还高息负债，再谈投资比例\n- 留出六个月生活开支作缓冲\n- 记账颗粒度到「类别」即可`)].join("\n");
const COMPACT = ["# 财务自由精华版", ...Array.from({ length: 7 }, (_, i) =>
  `\n## 精华版第 ${i + 1} 节\n- 先还高息负债\n- 六个月缓冲`)].join("\n");

const f = ((globalThis as any).fixture = {
  FULL, COMPACT,
  acceptImageGen: false,
  /** 出图建单是否放行（默认失败，用来把页面推进错误态）；放行时逐页返回图，用于验「停止出图」 */
  imageJobsSucceed: false,
  imageJobCalls: 0,
  cancelCalls: [] as string[],
  prepareDelayMs: 0,
  deriveStatus: "running" as "running" | "succeeded" | "failed",
  deriveCalls: 0,
  jobPolls: 0,
});

const ok = (json: unknown) =>
  new Response(JSON.stringify([{ result: { data: { json } } }]), {
    status: 200, headers: { "content-type": "application/json" },
  });

// 默认停在高级版：由测试显式切档，好观察派生这一刻
if (localStorage.getItem("mvs-knowledge-card-detail-level") === null) {
  localStorage.setItem("mvs-knowledge-card-detail-level", "full");
}
// 默认：先提炼、不出图。测试要让「清除」按钮出现时，把 acceptImageGen 打开——
// 出图会因为 /api/jobs 建单失败而报错，错误态下清除按钮才渲染。
window.confirm = (msg?: string) => {
  const text = String(msg || "");
  if (/先提炼/.test(text)) return true;
  if (/继续出图/.test(text)) return Boolean(f.acceptImageGen);
  return false;
};
window.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url || "");
  // 逐页出图（tRPC）：慢一点，好让测试在中途点「终止」。
  // 注意 httpBatchLink 会把并发的几页合成**一个**请求，必须按批里的调用数逐条回结果，
  // 只回一条会让客户端报 "Missing result"。
  if (/generatePlatformCompositeSheet/.test(url)) {
    let batchSize = 1;
    try {
      const parsed = JSON.parse(String(init?.body || "{}"));
      batchSize = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length || 1;
    } catch { /* 单条 */ }
    await new Promise((r) => setTimeout(r, 150));
    const results = Array.from({ length: batchSize }, () => {
      f.imageJobCalls += 1;
      return { result: { data: { json: { imageUrl: `https://storage.googleapis.com/test/page-${f.imageJobCalls}.png` } } } };
    });
    return new Response(JSON.stringify(results), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/prepareKnowledgeCardCopy/.test(url)) {
    if (f.prepareDelayMs > 0) await new Promise((r) => setTimeout(r, f.prepareDelayMs));
    return ok({ isAsync: false, distilledMarkdown: FULL });
  }
  // 读档任务的终止接口
  const cancelMatch = url.match(/\/api\/jobs\/knowledge-card\/([^/]+)\/cancel/);
  if (cancelMatch) {
    f.cancelCalls.push(decodeURIComponent(cancelMatch[1]!));
    return new Response(JSON.stringify({ jobId: cancelMatch[1], status: "running", cancelled: true, messageZh: "已请求停止，正在收口…" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  // 出图建单：默认失败（把页面推进错误态）；imageJobsSucceed 时逐页成功，用来验停止出图
  if (/\/api\/jobs(\?|$)/.test(url)) {
    if (!f.imageJobsSucceed) return new Response(JSON.stringify({ message: "出图建单失败（测试桩）" }), { status: 500, headers: { "content-type": "application/json" } });
    f.imageJobCalls += 1;
    return new Response(JSON.stringify({ id: `img-${f.imageJobCalls}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/enqueueKnowledgeCardLevelDerive/.test(url)) { f.deriveCalls++; return ok({ progressJobId: "derive-1" }); }
  if (/\/api\/jobs\/derive-1/.test(url)) {
    f.jobPolls++;
    const body =
      f.deriveStatus === "succeeded"
        ? { id: "derive-1", status: "succeeded", output: { distilledMarkdown: COMPACT, detailLevel: "concise" }, error: null }
        : f.deriveStatus === "failed"
          ? { id: "derive-1", status: "failed", output: null, error: "派生上游异常" }
          : { id: "derive-1", status: "running", output: { distillStage: "deriving", distillPercent: 30 }, error: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  return ok(null);
}) as typeof fetch;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })] });
createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}><PlatformPage /></QueryClientProvider>
  </trpc.Provider>,
);
