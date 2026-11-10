import {
  ADVISOR_VIDEO_EDIT_RANGE,
  prepareAdvisorVideoEditPrefill,
  type AdvisorVideoEditPrefill,
  type AdvisorVideoEditRef,
  type AdvisorVideoEditTarget,
} from "@shared/advisorVideoEdit";
import type { CreativeVoiceProductionAction } from "@shared/creativeVoiceProduction";
import { manhuaCreativeAdvisorContextSchema, type ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";
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
      const parts = await Promise.all(Array.from(controls.values()).map(c => inspectOf(c, signal)));
      const seen = new Set<string>();
      const videos = parts.flatMap(p => p.videos).filter(v => !seen.has(v.targetId) && Boolean(seen.add(v.targetId)));
      return JSON.stringify({ ...parts[0], videos, refs: parts.flatMap(p => p.refs) });
    }
    for (const c of Array.from(controls.values()))
      if ((await inspectOf(c, signal)).videos.some(v => v.targetId === action.targetId)) return c(action, signal);
    throw new Error("视频不在当前可编辑清单，请先读取可编辑视频，未打开");
  };
  return { register, control, size: () => controls.size };
}
export type AdvisorVideoEditHub = ReturnType<typeof createAdvisorVideoEditHub>;

/**
 * 只把「成片局部修改」开放给顾问的页面（代码动画 / 营销）：inspect 附带汇总清单；videoEdit 转汇总（只预填打开面板，
 * 报价/确认/提交仍由用户在面板点）；其他动作按各工作台现有方式拒绝。
 */
export function createVideoEditOnlyAdvisorAction(hub: AdvisorVideoEditHub, scope: string) {
  return async (action: CreativeVoiceProductionAction, signal: AbortSignal): Promise<string> => {
    signal.throwIfAborted();
    if (action.action === "inspect") {
      let videoEdit: unknown;
      try {
        videoEdit = JSON.parse(await hub.control({ action: "videoEdit", operation: "inspect" }, signal));
      } catch (e) {
        signal.throwIfAborted();
        videoEdit = { videos: [], note: e instanceof Error ? e.message : "成片清单暂时读不到" };
      }
      return JSON.stringify({ scope, operations: ["videoEdit"], videoEdit });
    }
    if (action.action === "videoEdit") return hub.control(action, signal);
    throw new Error("此操作请使用对应制作入口");
  };
}

export type VideoEditOnlyAdvisorWork = {
  /** 计费作品类型：代码动画按云端存档、营销按本稿成片任务核对；每部作品各自 5 次免费。 */
  kind: "code_motion" | "marketing";
  /** 作品编号（代码动画作品编号 / 营销制作稿编号）。 */
  projectId?: string;
  title: string;
  /** 顾问抬头与本页阶段，如「代码动画成片」。 */
  stageZh: string;
  /** 作品文字内容（可选）；含链接或凭证样式时省略，不阻断顾问。 */
  body?: string;
};

const VIDEO_EDIT_ONLY_DEFAULTS: Record<VideoEditOnlyAdvisorWork["kind"], { title: string; engine: string; asset: string }> = {
  code_motion: { title: "代码动画", engine: "代码动画渲染", asset: "已渲染的代码动画成片" },
  marketing: { title: "营销成片", engine: "营销成片拼接", asset: "已导出的营销口播成片（逐段画面 + 配音 + 字幕）" },
};

/** 两页顾问上下文：带作品类型与作品编号（额度查询随上下文带类型），阶段固定为成片。 */
export function videoEditOnlyAdvisorProject(work: VideoEditOnlyAdvisorWork) {
  const d = VIDEO_EDIT_ONLY_DEFAULTS[work.kind];
  const build = (title: string, body: string) =>
    manhuaCreativeAdvisorContextSchema.safeParse({
      ...(work.projectId ? { projectId: work.projectId } : {}),
      projectKind: work.kind,
      seriesTitle: title.slice(0, 200),
      episodeIndex: 1,
      episodeTitle: work.stageZh,
      stage: "final",
      videoModel: d.engine,
      writerConfirmed: true,
      episodeBody: body,
      assetSummary: d.asset,
      shotSummary:
        "本页顾问只能读取并预填成片局部修改：先用videoEdit inspect取得真实成片编号与时长，再prefill区间与修改要求。只打开面板预填，报价、确认与提交由用户在面板完成；其他制作请回到本页对应入口。",
      blockers: [],
    });
  const full = build(work.title.trim() || d.title, work.body?.trim() || `${d.title}成片`);
  const parsed = full.success ? full : build(d.title, `${d.title}成片`);
  if (!parsed.success) throw new Error("顾问上下文无效，未打开");
  const context: ManhuaCreativeAdvisorContext = parsed.data;
  return { context, issues: [], selectionLabel: work.stageZh, contextNotes: [], recommend3d: null, videoPromptDrafts: [] };
}
