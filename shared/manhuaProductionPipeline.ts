/**
 * 漫剧工厂方案 C：产品可调用流水线（非 Agent 对话手册）。
 * 题材 → Sol 剧本 → 资产锁定 → 10–12 段可拍表 → 每段 3–4 关键静帧 → 按秒导戏单 →（门禁后）视频。
 */

export type ManhuaProductionStepId =
  | "topic"
  | "screenplay"
  | "asset_lock"
  | "segment_plan"
  | "keyart"
  | "cue_sheet"
  | "video";

export const MANHUA_PRODUCTION_STEPS: ReadonlyArray<{
  id: ManhuaProductionStepId;
  label: string;
  hint: string;
}> = [
  { id: "topic", label: "题材", hint: "一句话题材与补充条件" },
  { id: "screenplay", label: "剧本", hint: "扩写可拍连载包并对白密度过关" },
  { id: "asset_lock", label: "资产锁定", hint: "角色脸 / 服化道 / 场景光影锁定" },
  { id: "segment_plan", label: "可拍表", hint: "10–12 段 × 每段约 15 秒" },
  { id: "keyart", label: "关键静帧", hint: "每段 3–4 张（起幅 / 戏核 / 落幅）" },
  { id: "cue_sheet", label: "导戏单", hint: "按秒对白·情绪·动作·运镜" },
  { id: "video", label: "成片", hint: "静帧与导戏单锁定后再出视频" },
];

export type ManhuaProductionProgress = {
  hasTopic: boolean;
  hasScreenplay: boolean;
  assetsLocked: boolean;
  segmentPlanReady: boolean;
  keyartsReady: boolean;
  cueSheetReady: boolean;
  hasClip: boolean;
};

export type ManhuaProductionStepState = {
  id: ManhuaProductionStepId;
  label: string;
  hint: string;
  status: "done" | "current" | "locked" | "pending";
};

/** 当前应推进的步骤（视频在前置未齐时始终 locked） */
export function resolveManhuaProductionActiveStep(
  p: ManhuaProductionProgress,
): ManhuaProductionStepId {
  if (p.hasClip) return "video";
  if (p.keyartsReady && p.cueSheetReady) return "video";
  if (p.keyartsReady) return "cue_sheet";
  if (p.segmentPlanReady && p.assetsLocked) return "keyart";
  if (p.assetsLocked) return "segment_plan";
  if (p.hasScreenplay) return "asset_lock";
  if (p.hasTopic) return "screenplay";
  return "topic";
}

/** 是否允许烧视频（默认禁止：须资产+可拍表+静帧+导戏单） */
export function canManhuaBurnVideo(p: ManhuaProductionProgress): boolean {
  return (
    p.assetsLocked &&
    p.segmentPlanReady &&
    p.keyartsReady &&
    p.cueSheetReady
  );
}

export function buildManhuaProductionStepStates(
  p: ManhuaProductionProgress,
): ManhuaProductionStepState[] {
  const active = resolveManhuaProductionActiveStep(p);
  const doneById: Record<ManhuaProductionStepId, boolean> = {
    topic: p.hasTopic,
    screenplay: p.hasScreenplay,
    asset_lock: p.assetsLocked,
    segment_plan: p.segmentPlanReady,
    keyart: p.keyartsReady,
    cue_sheet: p.cueSheetReady,
    video: p.hasClip,
  };
  return MANHUA_PRODUCTION_STEPS.map((step) => {
    if (step.id === "video" && !canManhuaBurnVideo(p) && !p.hasClip) {
      return { ...step, status: "locked" as const };
    }
    if (doneById[step.id]) return { ...step, status: "done" as const };
    if (step.id === active) return { ...step, status: "current" as const };
    return { ...step, status: "pending" as const };
  });
}
