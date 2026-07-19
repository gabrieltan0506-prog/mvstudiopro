import React, { useState } from "react";

export type ManhuaFactoryDebugLevel = "info" | "ok" | "warn" | "error";

export type ManhuaFactoryDebugEntry = {
  id: string;
  at: number;
  level: ManhuaFactoryDebugLevel;
  op: string;
  detail?: string;
  ms?: number;
  /** Debug B：可展开 request / response 原文 */
  request?: string;
  response?: string;
};

type Props = {
  enabled: boolean;
  entries: ManhuaFactoryDebugEntry[];
  injectSummary: string;
  onClear: () => void;
};

function levelClass(level: ManhuaFactoryDebugLevel): string {
  if (level === "error") return "text-red-300";
  if (level === "warn") return "text-amber-200";
  if (level === "ok") return "text-emerald-200";
  return "text-[#d7d0ef]";
}

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

function truncate(s: string, max = 12000): string {
  const t = String(s || "");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(截断 ${t.length - max} 字)`;
}

/** supervisor / admin 专用：阶段日志 + 注入摘要 + request/response 透视（方案 B） */
export default function ManhuaFactoryDebugPanel({
  enabled,
  entries,
  injectSummary,
  onClear,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!enabled) return null;

  return (
    <div className="mb-4 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff7fd5]">
          Canvas Factory Debug · B
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-white/35 hover:text-white/65"
        >
          清空
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">
            阶段日志（可展开 Request / Response）
          </div>
          {entries.length === 0 ? (
            <div className="mt-2 text-xs text-white/30">暂无记录。扩写 / 确认 / 跑工厂后会出现。</div>
          ) : (
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {entries.map((line) => {
                const expandable = Boolean(line.request || line.response);
                const open = openId === line.id;
                return (
                  <div
                    key={line.id}
                    className={`rounded-lg border border-white/5 bg-black/20 px-2 py-1.5 font-mono text-[11px] leading-5 ${levelClass(line.level)}`}
                  >
                    <button
                      type="button"
                      disabled={!expandable}
                      onClick={() => setOpenId(open ? null : line.id)}
                      className="flex w-full flex-wrap items-baseline gap-x-1 text-left disabled:cursor-default"
                    >
                      <span className="text-white/35">[{formatTime(line.at)}]</span>
                      <span className="text-cyan-200/90">{line.op}</span>
                      {typeof line.ms === "number" ? (
                        <span className="text-white/40"> · {line.ms}ms</span>
                      ) : null}
                      {expandable ? (
                        <span className="text-[10px] text-fuchsia-200/70">{open ? "▾" : "▸"}</span>
                      ) : null}
                    </button>
                    {line.detail ? <div className="pl-1 text-white/55">{line.detail}</div> : null}
                    {open && expandable ? (
                      <div className="mt-1.5 space-y-1.5 border-t border-white/10 pt-1.5 text-[10px] text-white/70">
                        {line.request ? (
                          <div>
                            <div className="text-white/35">Request</div>
                            <pre className="mt-0.5 max-h-36 overflow-auto whitespace-pre-wrap break-words text-white/65">
                              {truncate(line.request)}
                            </pre>
                          </div>
                        ) : null}
                        {line.response ? (
                          <div>
                            <div className="text-white/35">Response</div>
                            <pre className="mt-0.5 max-h-36 overflow-auto whitespace-pre-wrap break-words text-white/65">
                              {truncate(line.response)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">当前注入摘要</div>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/35 p-3 font-mono text-[11px] leading-5 text-[#d7d0ef]">
            {injectSummary || "（尚未选题材 / 配方）"}
          </pre>
        </div>
      </div>
    </div>
  );
}
