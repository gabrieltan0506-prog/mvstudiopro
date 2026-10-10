import { useSyncExternalStore } from "react";
import { clearApiDebugErrors, getApiDebugErrors, subscribeApiDebugErrors } from "@/lib/apiDebugErrors";

export function ApiErrorDebugPanel() {
  const errors = useSyncExternalStore(subscribeApiDebugErrors, getApiDebugErrors, getApiDebugErrors);
  return <section aria-label="接口错误 Debug" className="mb-6 rounded-2xl border border-red-300/30 bg-red-950/20 p-4 text-xs text-white/80">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold text-red-200">接口错误 Debug · 真实原因</h2>
      <button type="button" onClick={clearApiDebugErrors}>清空错误记录</button>
    </div>
    <p className="mt-2 text-white/50">记录本页最近30条失败，关闭Debug仍会记录。只保留脱敏摘要，刷新后清空；不会自动重试提交。</p>
    {!errors.length ? <p className="mt-3">本页尚无错误记录。</p> : <ol className="mt-3 max-h-96 space-y-3 overflow-auto">
      {errors.map(error => <li key={error.id} className="rounded-lg bg-black/20 p-3">
        <div>{new Date(error.time).toLocaleString("zh-CN", { hour12: false })} · {error.stage}</div>
        <div className="mt-1 break-all font-mono">接口：{error.endpoint}</div>
        <div>HTTP：{error.status ?? "未取得响应"} · Content-Type：{error.contentType || "未提供"}</div>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-red-100">{error.message}</pre>
      </li>)}
    </ol>}
  </section>;
}
