import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";


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
      condition(op) {
        return op.path === "mvAnalysis.getGrowthSnapshot";
      },
      true: httpLink({
        url: "/api/trpc",
        methodOverride: "POST",
        transformer: superjson,
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
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
