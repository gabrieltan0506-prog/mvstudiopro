import {
  ADVISOR_VIDEO_EDIT_RANGE,
  prepareAdvisorVideoEditPrefill,
  type AdvisorVideoEditPrefill,
  type AdvisorVideoEditRef,
  type AdvisorVideoEditTarget,
} from "@shared/advisorVideoEdit";
import type { AdvisorVideoEditControl, AdvisorVideoEditRegistration } from "./manhuaAdvisorWorkflowControl";

/**
 * 顾问 videoEdit 控件：inspect 列真实可编辑视频与参考图；prefill 只打开「视频局部修改」面板并预填（可多轮覆盖），
 * 不报价扣费、不提交——报价由面板只读查询显示，提交只在用户点面板确认后发生。
 */
export function createAdvisorVideoEditControl(deps: {
  targets: () => AdvisorVideoEditTarget[];
  refs?: () => AdvisorVideoEditRef[];
  range?: () => { minSec: number; maxSec: number } | undefined;
  /** 打开面板并以预填覆盖当前内容。 */
  open: (prefill: AdvisorVideoEditPrefill) => void;
  busy?: () => boolean;
}): AdvisorVideoEditControl {
  return async (action, signal) => {
    signal.throwIfAborted();
    const range = deps.range?.() ?? ADVISOR_VIDEO_EDIT_RANGE;
    if (action.operation === "inspect")
      return JSON.stringify({
        videos: deps.targets().map(t => ({ targetId: t.id, label: t.label, durationSec: t.durationSec })),
        refs: (deps.refs?.() ?? []).map(r => ({ refAssetId: r.id, label: r.label })),
        minSec: range.minSec,
        maxSec: range.maxSec,
        note: "prefill 只打开视频局部修改面板并预填，报价与提交由用户在面板确认",
      });
    if (deps.busy?.()) throw new Error("视频局部修改正在提交或处理中，未改动预填");
    const prefill = prepareAdvisorVideoEditPrefill(action, deps.targets(), deps.refs?.() ?? [], range);
    signal.throwIfAborted();
    deps.open(prefill);
    return JSON.stringify({
      status: "prefilled",
      targetId: prefill.targetId,
      startSec: prefill.startSec,
      endSec: prefill.endSec,
      ...(prefill.noticeZh ? { notice: prefill.noticeZh } : {}),
      note: "已打开视频局部修改面板并预填，尚未提交、未扣积分；请用户在面板查看报价并点确认后才会提交",
    });
  };
}

/**
 * 同一顾问下挂多个「局部修改」入口时的汇总：各入口以唯一 key 登记（复用 AdvisorVideoEditRegistration），
 * inspect 合并各入口清单（targetId 由各入口保证唯一），prefill 按 targetId 转给列出它的入口；只预填、不提交。
 */
export function createAdvisorVideoEditHub() {
  const controls = new Map<string, AdvisorVideoEditControl>();
  const registrations = new Map<string, AdvisorVideoEditRegistration>();
  const register = (key: string): AdvisorVideoEditRegistration => {
    let r = registrations.get(key);
    if (!r) {
      r = c => {
        if (c) controls.set(key, c);
        else controls.delete(key);
      };
      registrations.set(key, r);
    }
    return r;
  };
  type Inspect = { videos: Array<{ targetId: string }>; refs: unknown[]; [k: string]: unknown };
  const inspectOf = async (c: AdvisorVideoEditControl, signal: AbortSignal) =>
    JSON.parse(await c({ action: "videoEdit", operation: "inspect" }, signal)) as Inspect;
  const control: AdvisorVideoEditControl = async (action, signal) => {
    if (!controls.size) throw new Error("当前页面没有可局部修改的成片，请先生成成片或打开对应的「局部修改」，未打开");
    if (action.operation === "inspect") {
      const parts = await Promise.all([...controls.values()].map(c => inspectOf(c, signal)));
      const seen = new Set<string>();
      const videos = parts.flatMap(p => p.videos).filter(v => !seen.has(v.targetId) && Boolean(seen.add(v.targetId)));
      return JSON.stringify({ ...parts[0], videos, refs: parts.flatMap(p => p.refs) });
    }
    for (const c of controls.values())
      if ((await inspectOf(c, signal)).videos.some(v => v.targetId === action.targetId)) return c(action, signal);
    throw new Error("视频不在当前可编辑清单，请先读取可编辑视频，未打开");
  };
  return { register, control, size: () => controls.size };
}
