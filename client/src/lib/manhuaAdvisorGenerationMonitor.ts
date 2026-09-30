import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex } from "./canvasDramaStudio";
import type { AdvisorIssue } from "./manhuaAdvisorProject";
import { manhuaIssueResolutionZh } from "./manhuaMainTaskBlockers";

export type AdvisorGenerationStep = {
  id: string;
  label: string;
  phase: AdvisorIssue["phase"];
  state: "waiting" | "running" | "verify" | "blocked" | "output";
  summary: string;
  problems: Array<{ id: string; reason: string; resolution: string }>;
};
export const ADVISOR_GENERATION_STATE_ZH = {
  waiting: "待制作", running: "生成中", verify: "待核实", blocked: "未通过", output: "已有产物·待验收",
} as const;

/** 不把服务错误里的媒体地址或凭证带进顾问上下文。 */
function safeReason(value: string | undefined): string {
  return String(value || "")
    .replace(/(?:https?|gs|data|blob):\/\/\S+/gi, "[媒体地址已省略]")
    .replace(/(?:bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*\S+|\bsk-[\w-]+)/gi, "[凭证已省略]")
    .slice(0, 280);
}

/** 只派生已有草稿/任务状态；不创建任务、不重试、不修改门禁或采用关系。 */
export function buildManhuaAdvisorGenerationMonitor(input: {
  episodeIndex: number;
  blocks: CanvasBlock[];
  refs: ManhuaCustomAssetRef[];
  issues: AdvisorIssue[];
  hasScript: boolean;
  writerBusy?: boolean;
  factoryBusy?: boolean;
  assembleBusy?: boolean;
}): AdvisorGenerationStep[] {
  const scoped = input.blocks.filter(b => !b.archivedFromPreviousScript && (getBlockEpisodeIndex(b) ?? 1) === input.episodeIndex);
  const steps: AdvisorGenerationStep[] = [
    ["outline", "剧本", "outline"], ["assets", "参考图", "assets"],
    ["model3d", "角色建模", "assets"], ["world3d", "3D 场景", "assets"],
    ["previs", "动作白模", "storyboard"], ["keyart", "关键静帧", "storyboard"],
    ["video", "分段视频", "edit"], ["audio", "对白与音轨", "edit"],
    ["final", "整集合成与终审", "final"],
  ].map(([id, label, phase]) => ({ id, label, phase: phase as AdvisorIssue["phase"], state: "waiting", summary: "没有本步任务回执", problems: [] }));
  const get = (id: string) => steps.find(s => s.id === id)!;
  const counts = new Map(steps.map(s => [s.id, { running: 0, verify: 0, output: 0 }]));
  const problem = (step: AdvisorGenerationStep, id: string, reason: string, resolution: string) => {
    step.problems.push({ id, reason: safeReason(reason), resolution });
  };
  const task = (step: AdvisorGenerationStep, id: string, status: string, output: boolean, error?: string) => {
    const count = counts.get(step.id)!;
    if (["queued", "running"].includes(status)) count.running++;
    else if (["reconcile_manual", "timed_out_pending_reconcile", "unverified", "pending_submit"].includes(status)) {
      count.verify++;
      problem(step, id, `${id}：任务回执待核实。`, "查询原任务回执和扣费状态；未核实前不要重复提交。");
    } else if (["failed", "error"].includes(status)) {
      problem(step, id, `${id}：${safeReason(error) || "本次生成失败。"}`, "打开本步核对失败原因、输入和原任务回执；保留旧产物，重新生成前确认费用。");
    } else if (output) count.output++;
    else if (["succeeded", "done"].includes(status)) {
      count.verify++;
      problem(step, id, `${id}：任务报成功，但当前草稿没有可读取的产物。`, "核对原任务与回填状态，不要重交或手工改写关联。");
    }
  };
  if (input.hasScript) counts.get("outline")!.output++;
  if (input.writerBusy) counts.get("outline")!.running++;
  // 参考图/模型为项目共享资产；明确标记范围，不把异集节点带入本集。
  counts.get("assets")!.output = input.refs.filter(r => Boolean(r.url || r.gcsUri)).length;
  for (const ref of input.refs) {
    if (ref.model3d) task(get("model3d"), `${ref.labelZh || ref.id} · ${ref.model3d.taskId}`, ref.model3d.status, Boolean(ref.model3d.glbGcsUri || ref.model3d.glbUrl), ref.model3d.errorZh);
    if (ref.world3d) task(get("world3d"), `${ref.labelZh || ref.id} · ${ref.world3d.taskId}`, ref.world3d.status, Boolean(ref.world3d.assets?.spz500kGcsUri || ref.world3d.assets?.spz500kUrl || ref.world3d.assets?.spzFullGcsUri || ref.world3d.assets?.spzFullUrl), ref.world3d.errorZh);
  }
  for (const b of scoped) {
    const stepId = b.id.startsWith("final-") ? "final" : b.id.startsWith("keyart-") ? "keyart" : b.id.startsWith("clip-") ? "video" : /^(beats|reverse|story)-/.test(b.id) ? "outline" : /^(charsheet|sceneplate|prop)-/.test(b.id) ? "assets" : null;
    if (stepId) task(get(stepId), b.videoTaskId || b.id, b.videoIntentStatus === "unverified" || b.videoIntentStatus === "pending_submit" ? b.videoIntentStatus : b.videoTaskStatus || b.status, Boolean(b.outputUrl || b.outputUrls?.length || b.outputText?.trim()), b.error);
    if (b.previsStudio?.pending) task(get("previs"), b.previsStudio.pending.requestId, "unverified", false);
    else if (b.previsStudio?.history.length) counts.get("previs")!.output++;
    for (const op of b.audioStudio?.pendingOperations || []) task(get("audio"), op.id, op.errorZh ? "failed" : "unverified", false, op.errorZh);
    counts.get("audio")!.output += (b.audioStudio?.cues || []).filter(c => c.enabled && c.approved && (c.source || c.takes.some(t => t.id === c.selectedTakeId))).length;
    if (b.manhuaClipQuality && !b.manhuaClipQuality.userAcceptedDespiteQc && ["failed", "unverified"].includes(b.manhuaClipQuality.status)) {
      problem(get("final"), `qc-${b.id}`, `${b.id}：${safeReason(b.manhuaClipQuality.summary) || "本段质检尚未通过。"}`, "回成片查看质检与实际视频，核对后决定修正或采用；顾问不会代替你放行。");
    }
  }
  if (input.assembleBusy) counts.get("final")!.running++;
  for (const issue of input.issues.filter(i => i.blocking)) {
    const id = issue.id === "keyframe" ? "keyart" : issue.phase === "outline" ? "outline" : issue.phase === "assets" ? "assets" : issue.phase === "final" ? "final" : "video";
    problem(get(id), issue.id, issue.text, manhuaIssueResolutionZh(issue));
  }
  for (const step of steps) {
    const count = counts.get(step.id)!;
    step.state = step.problems.some(p => !/回执待核实|草稿没有可读取/.test(p.reason)) ? "blocked" : count.verify ? "verify" : count.running ? "running" : count.output ? "output" : "waiting";
    step.summary = [count.running ? `${count.running} 项处理中` : "", count.verify ? `${count.verify} 项待核实` : "", count.output ? `${count.output} 项已有产物` : "", step.problems.length ? `${step.problems.length} 项需处理` : ""].filter(Boolean).join(" · ") || (input.factoryBusy ? "工厂运行中；本步尚无可归属的任务回执" : "没有本步任务回执");
    if (["assets", "model3d", "world3d"].includes(step.id)) step.summary += "（项目共享资产）";
  }
  return steps;
}

export function advisorGenerationContextZh(steps: AdvisorGenerationStep[]): string {
  return ["【本集生成步骤监看·只读状态，不代表画面/声音验收】", ...steps.map(s => `${s.label}：${ADVISOR_GENERATION_STATE_ZH[s.state]}；${s.summary}${s.problems.map(p => `\n${p.reason} 处理办法：${p.resolution}`).join("")}`)].join("\n");
}
