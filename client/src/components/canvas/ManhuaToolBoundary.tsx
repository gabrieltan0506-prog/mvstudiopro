import type { ReactNode } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";

/** Local render recovery only: no media submission, project reset or page reload. */
export function ManhuaToolBoundary({ title, children }: { title: string; children: ReactNode }) {
  return <ErrorBoundary fallback={(_error, reset) => <div role="alert"
    className="my-3 rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
    <p className="font-semibold">{title}暂时无法显示</p>
    <p className="my-2 text-xs leading-relaxed">可重新打开此面板，或切换其他工具。重新打开不会提交生成任务。</p>
    <button type="button" onClick={reset} className="rounded-lg border border-amber-300/40 px-3 py-2 text-xs">
      重新打开{title}
    </button>
  </div>}>{children}</ErrorBoundary>;
}
