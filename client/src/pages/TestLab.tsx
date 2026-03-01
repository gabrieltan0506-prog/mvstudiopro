import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

type MeResp =
  | { ok: true; user?: { id: string; email?: string; role?: string }; credits?: number; verifyStatus?: string }
  | { ok: false; error?: string };

async function fetchMe(): Promise<MeResp> {
  const r = await fetch("/api/me", {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "application/json" },
  });
  // 有些错配会返回 HTML，这里兜底
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return { ok: false, error: "non-json response" };
  }
  return (await r.json()) as MeResp;
}

export default function TestLab() {
  const [me, setMe] = useState<MeResp | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  // Image test
  const [imgPrompt, setImgPrompt] = useState("生成一张 1K 的未来感女偶像电影人像，细节丰富，灯光高级，背景简洁。");
  const [imgProvider, setImgProvider] = useState<"nano-banana-flash" | "nano-banana-pro" | "kling_image">("nano-banana-flash");
  const [imgStatus, setImgStatus] = useState<string>("");
  const [imgUrls, setImgUrls] = useState<string[]>([]);

  // Video test (Kling)
  const [vidPrompt, setVidPrompt] = useState("未来感女偶像在霓虹城市街头回眸，电影级光影，镜头缓慢推进，质感高级。");
  const [vidProvider, setVidProvider] = useState<string>("kling_beijing");
  const [vidStatus, setVidStatus] = useState<string>("");
  const [vidTaskId, setVidTaskId] = useState<string>("");
  const [vidShortUrl, setVidShortUrl] = useState<string>("");

  const authed = useMemo(() => !!me && (me as any).ok === true, [me]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setMeLoading(true);
      try {
        const data = await fetchMe();
        if (!alive) return;
        setMe(data);
      } catch (e: any) {
        if (!alive) return;
        setMe({ ok: false, error: e?.message || "fetch /api/me failed" });
      } finally {
        if (!alive) return;
        setMeLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function refreshMe() {
    setMeLoading(true);
    try {
      const data = await fetchMe();
      setMe(data);
    } catch (e: any) {
      setMe({ ok: false, error: e?.message || "fetch /api/me failed" });
    } finally {
      setMeLoading(false);
    }
  }

  async function runImageTest() {
    setImgStatus("提交中…");
    setImgUrls([]);
    try {
      // 兼容：如果你们已有图片 job API，这里尽量走 /api/jobs（若后端没支持图片，会返回 JSON error）
      const r = await fetch(`/api/jobs?provider=${encodeURIComponent(imgProvider)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: imgPrompt, type: "image", size: "1024" }),
      });

      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setImgStatus(`失败：non-json response (${r.status})`);
        return;
      }
      const j = await r.json();

      // 兼容多种返回：
      // 1) { ok:true, images:[{url}] }
      // 2) { ok:true, imageUrl:"..." }
      // 3) { ok:false, error:"..." }
      if (j?.ok !== true) {
        setImgStatus(`失败：${j?.error || "unknown error"}`);
        return;
      }

      const urls: string[] = [];
      if (Array.isArray(j?.images)) {
        for (const it of j.images) if (it?.url) urls.push(it.url);
      }
      if (typeof j?.imageUrl === "string") urls.push(j.imageUrl);
      if (typeof j?.url === "string") urls.push(j.url);

      setImgUrls(urls);
      setImgStatus(urls.length ? "成功" : "成功（但未返回图片 URL，检查后端返回字段）");
    } catch (e: any) {
      setImgStatus(`失败：${e?.message || "unknown error"}`);
    }
  }

  async function runVideoTest() {
    setVidStatus("提交中…");
    setVidTaskId("");
    setVidShortUrl("");
    try {
      const r = await fetch(`/api/jobs?provider=${encodeURIComponent(vidProvider)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: vidPrompt }),
      });

      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setVidStatus(`失败：non-json response (${r.status})`);
        return;
      }
      const j = await r.json();

      if (j?.ok !== true) {
        setVidStatus(`失败：${j?.error || "unknown error"}`);
        return;
      }

      const taskId = j?.taskId || j?.task_id || j?.raw?.data?.task_id;
      if (!taskId) {
        setVidStatus("成功（但未解析到 taskId，检查后端返回字段）");
        return;
      }
      setVidTaskId(String(taskId));

      // 你们短链是 /api/v/:taskId
      const shortUrl = `/api/v/${encodeURIComponent(String(taskId))}`;
      setVidShortUrl(shortUrl);
      setVidStatus("已提交（生成中/可轮询）");
    } catch (e: any) {
      setVidStatus(`失败：${e?.message || "unknown error"}`);
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">测试台</h1>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-sm text-slate-600 hover:underline dark:text-slate-300">
              返回首页
            </Link>
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={refreshMe}
              disabled={meLoading}
            >
              刷新登录状态
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">登录状态：</span>
            {meLoading ? (
              <span className="text-slate-500 dark:text-slate-400">检查中…</span>
            ) : authed ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                已登录（{(me as any)?.user?.role || "user"} / {(me as any)?.user?.email || (me as any)?.user?.id || "unknown"}）
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-400">
                未登录（{(me as any)?.error || "no session"}）—{" "}
                <Link href="/login" className="underline">
                  去登录
                </Link>
              </span>
            )}
            {authed && typeof (me as any)?.credits === "number" ? (
              <span className="ml-auto text-slate-600 dark:text-slate-300">Credits：{(me as any).credits}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">图像生成（1K）</h2>
            <div className="mt-3">
              <label className="block text-sm text-slate-700 dark:text-slate-200">模型</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={imgProvider}
                onChange={(e) => setImgProvider(e.target.value as any)}
                disabled={!authed}
              >
                <option value="nano-banana-flash">nano-banana-flash（免费/低配）</option>
                <option value="nano-banana-pro">nano-banana-pro（付费/高配）</option>
                <option value="kling_image">kling_image（付费/备用）</option>
              </select>
            </div>
            <div className="mt-3">
              <label className="block text-sm text-slate-700 dark:text-slate-200">Prompt</label>
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                rows={5}
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                disabled={!authed}
              />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                onClick={runImageTest}
                disabled={!authed}
              >
                生成图片
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-300">{imgStatus}</span>
            </div>

            {imgUrls.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {imgUrls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                    <img src={u} className="h-48 w-full rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">视频生成（Kling）</h2>
            <div className="mt-3">
              <label className="block text-sm text-slate-700 dark:text-slate-200">Provider</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={vidProvider}
                onChange={(e) => setVidProvider(e.target.value)}
                disabled={!authed}
              >
                <option value="kling_beijing">kling_beijing</option>
              </select>
            </div>

            <div className="mt-3">
              <label className="block text-sm text-slate-700 dark:text-slate-200">Prompt</label>
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                rows={5}
                value={vidPrompt}
                onChange={(e) => setVidPrompt(e.target.value)}
                disabled={!authed}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                onClick={runVideoTest}
                disabled={!authed}
              >
                提交生成
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-300">{vidStatus}</span>
            </div>

            {vidTaskId ? (
              <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <div>TaskId：{vidTaskId}</div>
                {vidShortUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="underline" href={vidShortUrl} target="_blank" rel="noreferrer">
                      打开短链（/api/v/{vidTaskId}）
                    </a>
                    <button
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      onClick={() => navigator.clipboard.writeText(window.location.origin + vidShortUrl)}
                    >
                      复制链接
                    </button>
                  </div>
                ) : null}
                {vidShortUrl ? (
                  <video className="mt-2 w-full rounded-lg" controls src={vidShortUrl} />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div className="font-medium text-slate-700 dark:text-slate-200">说明</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>此页只依赖 <code>/api/me</code> 判断登录，不再用任何“前端猜测/硬编码”规则。</li>
            <li>如果你已用 dev_admin 登录，但仍提示未登录：点击“刷新登录状态”。</li>
            <li>若图片/视频返回成功但没 URL：属于后端返回字段不一致，页面会提示“未返回 URL”。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
