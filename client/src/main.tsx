import { trpc } from "@/lib/trpc";
import { withFlyHealthGate } from "@/lib/flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

// ─── PWA Service Worker Registration ──────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(
      (registration) => {
        console.log("ServiceWorker registration successful with scope: ", registration.scope);
      },
      (err) => {
        console.log("ServiceWorker registration failed: ", err);
      }
    );
  });
}

// CHUNK_LOAD_FAIL_GUARD
(function () {
  const KEY = "mv_chunk_reload_once";
  const shouldReloadOnce = () => {
    try { return !sessionStorage.getItem(KEY); } catch { return true; }
  };
  const markReloaded = () => {
    try { sessionStorage.setItem(KEY, "1"); } catch {}
  };

  const isChunkError = (msg: unknown) =>
    typeof msg === "string" &&
    (msg.includes("Failed to fetch dynamically imported module") ||
     msg.includes("Importing a module script failed") ||
     msg.includes("Loading chunk") ||
     msg.includes("ChunkLoadError"));

  window.addEventListener("error", (e) => {
    const msg = (e && (e.message || (e.error && e.error.message))) || "";
    if (isChunkError(msg) && shouldReloadOnce()) {
      markReloaded();
      const u = new URL(window.location.href);
      u.searchParams.set("__reload", String(Date.now()));
      window.location.replace(u.toString());
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e && e.reason;
    const msg = (reason && (reason.message || String(reason))) || "";
    if (isChunkError(msg) && shouldReloadOnce()) {
      markReloaded();
      const u = new URL(window.location.href);
      u.searchParams.set("__reload", String(Date.now()));
      window.location.replace(u.toString());
    }
  });
})();

const queryClient = new QueryClient();

/**
 * 生產：前端只請求同源 `/api/*`（Fly 一體部署或由 CDN 反代至 Fly），瀏覽器視為同源，
 * 減少跨域 preflight、Cookie 為第一方 Lax。
 * 長鏈路 procedure 仍用獨立 httpLink（不 batch），並經 `/api/health` 閘門。
 */
const FLY_DIRECT_TRPC_PATHS = new Set([
  "mvAnalysis.getGrowthSnapshot",
  "mvAnalysis.getPlatformDashboard",
  "ambient.dashboardLive",
  "ambient.dashboardNews",
  "ambient.hybridDashboard",
  "ambient.mascotCareMessage",
]);

/**
 * 分钟级 GPT-IMAGE-2 / 编导链：不从 httpBatchLink 拼车发送，减轻中间层对大体量 JSON 的请求异常与「Pending 过久 → Failed to fetch」体感。
 */
const MV_ANALYSIS_UNBATCH_IMAGE_MUTATION_PATHS = new Set([
  "mvAnalysis.generatePlatformCompositeSheet",
  "mvAnalysis.generateTopicImage",
  "mvAnalysis.generateAllPlatformTopicImages",
]);

function useFlyDirectTrpcLink(op: { path: string }) {
  return FLY_DIRECT_TRPC_PATHS.has(op.path);
}

function useMvAnalysisUnbatchImageMutationLink(op: { path: string }) {
  return MV_ANALYSIS_UNBATCH_IMAGE_MUTATION_PATHS.has(op.path);
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe((event: any) => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query AlertCircle]", error);
  }
});

queryClient.getMutationCache().subscribe((event: any) => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation AlertCircle]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: useMvAnalysisUnbatchImageMutationLink,
      true: httpLink({
        url: withLongJobsFlyDirect("/api/trpc"),
        transformer: superjson,
        fetch(input, init) {
          const urlStr = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
          const origin = flyHealthProbeOriginForUrl(urlStr);
          return withFlyHealthGate(origin, () =>
            globalThis.fetch(input, {
              ...(init ?? {}),
              credentials: "include",
            }),
          );
        },
      }),
      false: splitLink({
        condition: useFlyDirectTrpcLink,
        true: httpLink({
          url: withLongJobsFlyDirect("/api/trpc"),
          transformer: superjson,
          fetch(input, init) {
            const urlStr = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
            const origin = flyHealthProbeOriginForUrl(urlStr);
            return withFlyHealthGate(origin, () =>
              globalThis.fetch(input, {
                ...(init ?? {}),
                credentials: "include",
              }),
            );
          },
        }),
        false: httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          fetch(input, init) {
            return globalThis.fetch(input, {
              ...(init ?? {}),
              credentials: "include",
            });
          },
        }),
      }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
