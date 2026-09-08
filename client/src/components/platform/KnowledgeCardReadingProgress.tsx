import { useEffect, useState } from "react";

type ProgressTime = string | number | Date | null;
export interface KnowledgeCardReadingProgressProps {
  progress: { done: number; total: number; stage?: string; updatedAt?: ProgressTime; heartbeatAt?: ProgressTime };
  jobStatus?: string;
  phase?: string;
  locale?: string;
}

function timestamp(value: ProgressTime | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const time = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : undefined;
}

function stageLabel(stage: string | undefined, phase: string | undefined): string {
  const reading = stage?.match(/^reading:(\d+)\/(\d+)$/);
  if (reading) return `阅读图文（第${reading[1]}/${reading[2]}份材料）`;
  const labels: Record<string, string> = {
    starting: "启动读取", preparing: "准备原始材料", rendering: "整理原页图像", prepared: "原页整理完成",
    reading: "阅读图文", planning: "整理方案", writing: "编写逐页正文",
    done: "读取阶段结束", idle: "等待开始", ready: "方案可查看", generating: "生成知识卡", failed: "任务遇到问题",
  };
  return labels[stage || ""] || labels[phase || ""] || "等待阶段说明";
}

export function KnowledgeCardReadingProgress({ progress, phase, jobStatus, locale = "zh-CN" }: KnowledgeCardReadingProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const done = Number.isFinite(progress.done) ? Math.max(0, Math.floor(progress.done)) : 0;
  const total = Number.isFinite(progress.total) ? Math.max(0, Math.floor(progress.total)) : 0;
  const preparing = ["starting", "preparing", "rendering", "prepared", "planning", "writing"].includes(progress.stage || "");
  const percent = total > 0 ? Math.min(100, Math.floor(done / total * 100)) : undefined;
  const updatedAt = timestamp(progress.updatedAt);
  const heartbeatAt = timestamp(progress.heartbeatAt);
  const terminal = ["completed", "succeeded", "failed", "cancelled"].includes(jobStatus || "") || ["ready", "failed"].includes(phase || "");
  const stale = !terminal && updatedAt != null && now - updatedAt >= 90_000;
  function formatTime(time: number | undefined) {
    if (time == null) return "未提供";
    try { return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(time); }
    catch { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(time); }
  }
  return <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 text-xs text-slate-600" aria-label="材料读取进展">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>当前阶段：{stageLabel(progress.stage, phase)}</span>
      <strong className="text-slate-800">{percent == null ? "确认总量中" : `${preparing ? "本阶段进度" : "材料读取"} ${percent}%`}</strong>
    </div>
    <div role="progressbar" aria-label="材料读取进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-valuetext={percent == null ? "确认总量中" : `${done}/${total}个读取单元，${percent}%`}
      className="h-2 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-sky-600" style={{ width: `${percent ?? 0}%` }} />
    </div>
    <p>{total > 0 ? `${done}/${total}个${preparing ? "整理" : "读取"}单元` : `${preparing ? "已整理" : "已读"}${done}个单元，总量待确认`}（PDF按页，纯文字按段）。</p>
    {percent === 100 && !preparing && <p>读取单元已读完；方案整理与正文编写进度以当前阶段为准。</p>}
    <p data-progress-time="content">最后内容进展：{formatTime(updatedAt)}</p>
    <p data-progress-time="heartbeat">最近后端心跳：{formatTime(heartbeatAt)}</p>
    {heartbeatAt != null && <p>心跳仅表示后端活动，不代表内容读取有新进展。</p>}
    {stale && <p role="status" className="text-amber-700">暂未收到新进展，可查询原任务。</p>}
  </div>;
}
