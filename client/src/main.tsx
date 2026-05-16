import { trpc } from "@/lib/trpc";
import { trpcBaseUrlToOrigin, withFlyHealthGate } from "@/lib/flyHealthGate";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

// Bypass Vercel Serverless Function proxying for API calls to improve latency
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  
  let urlObj;
  try {
    urlObj = new URL(resource instanceof Request ? resource.url : resource, window.location.origin);
  } catch (e) {
    // Ignore invalid URLs
  }

  if (urlObj && urlObj.pathname.startsWith("/api/")) {
    const hostname = window.location.hostname;
    // Intercept both relative "/api/..." and absolute "https://mvstudiopro.com/api/..."
    if (hostname === "mvstudiopro.com" || hostname === "www.mvstudiopro.com") {
      urlObj.host = "mvstudiopro.fly.dev";
      urlObj.protocol = "https:";
      resource = urlObj.toString();
      // Ensure credentials are included for cross-origin API calls to fly.dev
      config = { ...config, credentials: "include" };
    }
  }
  return originalFetch(resource, config);
};

// 與 fetch 一致：正式網域上 XMLHttpRequest 打 /api 時直連 Fly（例如 MVAnalysis 影片上傳）
const originalXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
) {
  let nextUrl = url;
  try {
    const hostname = window.location.hostname;
    if (hostname === "mvstudiopro.com" || hostname === "www.mvstudiopro.com") {
      const u = new URL(String(url), window.location.origin);
      if (u.pathname.startsWith("/api/")) {
        u.host = "mvstudiopro.fly.dev";
        u.protocol = "https:";
        nextUrl = u.toString();
      }
    }
  } catch {
    /**/
  }
  return originalXhrOpen.call(this, method, nextUrl, async ?? true, username ?? undefined, password ?? undefined);
};

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
 * 生产站（如 mvstudiopro.com）在 Vercel 上会把 `/api/*` rewrite 到 Fly（见 vercel.json）。
 * 下列 procedure 在生产环境由浏览器直连 Fly（`resolveMvAnalysisLongTrpcUrl`），少一跳边缘代理，降低长 LLM 响应被掐断的概率。
 * 说明：Vercel Hobby 的「12 个函数」指 `api/*.ts` Serverless 条目数；tRPC 主体在 Fly，新增吉祥物/ambient 能力不会占用该配额。
 *
 * 本地开发仍走同源 `/api/trpc`。可选用 `VITE_MV_ANALYSIS_TRPC_URL` 覆盖。
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

const DEFAULT_MV_ANALYSIS_TRPC_ORIGIN = "https://mvstudiopro.fly.dev/api/trpc";

function resolveMvAnalysisLongTrpcUrl(): string | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return null;
  const env = String(import.meta.env.VITE_MV_ANALYSIS_TRPC_URL || "").trim();
  if (env) {
    try {
      const u = new URL(env);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        console.warn(
          "[tRPC] VITE_MV_ANALYSIS_TRPC_URL 需为 http(s)，已回退直连:",
          DEFAULT_MV_ANALYSIS_TRPC_ORIGIN,
        );
        return DEFAULT_MV_ANALYSIS_TRPC_ORIGIN;
      }
      return u.href.replace(/\/$/, "");
    } catch {
      /** 相对路径或非法值会令 new URL 失败；勿整体 return null，否则长链路会落回 `/api/trpc`（Vercel rewrite 易 502 / 截断） */
      console.warn(
        "[tRPC] VITE_MV_ANALYSIS_TRPC_URL 非合法绝对 URL，已回退直连:",
        DEFAULT_MV_ANALYSIS_TRPC_ORIGIN,
      );
      return DEFAULT_MV_ANALYSIS_TRPC_ORIGIN;
    }
  }
  return DEFAULT_MV_ANALYSIS_TRPC_ORIGIN;
}

const mvAnalysisLongTrpcUrl = resolveMvAnalysisLongTrpcUrl();

function useFlyDirectTrpcLink(op: { path: string }) {
  return Boolean(mvAnalysisLongTrpcUrl) && FLY_DIRECT_TRPC_PATHS.has(op.path);
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
        url: "/api/trpc",
        transformer: superjson,
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
      false: splitLink({
        condition: useFlyDirectTrpcLink,
        true: httpLink({
          url: mvAnalysisLongTrpcUrl!,
          transformer: superjson,
          fetch(input, init) {
            const flyOrigin = trpcBaseUrlToOrigin(mvAnalysisLongTrpcUrl!);
            return withFlyHealthGate(flyOrigin, () =>
              globalThis.fetch(input, {
                ...(init ?? {}),
                credentials: "omit",
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
