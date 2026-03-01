import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

type MeOk = { ok: true; user?: { id: string; email?: string; role?: string }; credits?: number; verifyStatus?: string };
type MeBad = { ok: false; error?: string };
type MeResp = MeOk | MeBad;

async function getMe(): Promise<MeResp> {
  const r = await fetch("/api/me", { credentials: "include", headers: { Accept: "application/json" } });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return { ok: false, error: "non-json" };
  return (await r.json()) as MeResp;
}

export default function TestLab() {
  const [me, setMe] = useState<MeResp | null>(null);
  const [loading, setLoading] = useState(true);

  const authed = useMemo(() => !!me && (me as any).ok === true, [me]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await getMe();
      setMe(data);
    } catch (e: any) {
      setMe({ ok: false, error: e?.message || "fetch failed" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">测试台</h1>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-600 hover:underline dark:text-slate-300">返回首页</Link>
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={refresh}
              disabled={loading}
            >
              刷新登录状态
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">登录状态：</span>
            {loading ? (
              <span className="text-slate-500 dark:text-slate-400">检查中…</span>
            ) : authed ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                已登录（{(me as any)?.user?.role || "user"} / {(me as any)?.user?.email || (me as any)?.user?.id || "unknown"}）
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-400">
                未登录（{(me as any)?.error || "no session"}）— <Link href="/login" className="underline">去登录</Link>
              </span>
            )}
            {authed && typeof (me as any)?.credits === "number" ? (
              <span className="ml-auto text-slate-600 dark:text-slate-300">Credits：{(me as any).credits}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div className="font-medium text-slate-700 dark:text-slate-200">验收</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>打开 /test-lab 不再 404/NotFound。</li>
            <li>刷新后能看到 /api/me 的 ok=true 即显示“已登录”。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
