import { trpc } from "@/lib/trpc";
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
 * 生产站（如 mvstudiopro.com）在 Vercel 上会把 `/api/*` rewrite 到 Fly（见 vercel.json）。
 * 该「多一跳」边缘代理对分钟级 LLM 响应常先断开，浏览器报 JSON 截断；Fly 侧 Vertex 仍可能跑完 → 白耗算力。
 * 与早期行为一致：快照 / 看板 / 文案直连接 rewrite 背后的同一 Fly tRPC 端点，绕开 Vercel 长响应限制。
 *
 * 本地开发仍走同源 `/api/trpc`。可选用 `VITE_MV_ANALYSIS_TRPC_URL` 覆盖（例如日后自有 API 子域）。
 */
const MV_ANALYSIS_LONG_TRPC_PATHS = new Set([
  "mvAnalysis.getGrowthSnapshot",
  "mvAnalysis.getPlatformDashboard",
  "mvAnalysis.getPlatformContent",
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

function useMvAnalysisLongTrpcLink(op: { path: string }) {
  return Boolean(mvAnalysisLongTrpcUrl) && MV_ANALYSIS_LONG_TRPC_PATHS.has(op.path);
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
      condition: useMvAnalysisLongTrpcLink,
      true: httpLink({
        url: mvAnalysisLongTrpcUrl!,
        transformer: superjson,
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "omit",
          });
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
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
