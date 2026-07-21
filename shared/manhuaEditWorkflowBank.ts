/**
 * 漫剧「结构化剪辑」工作流节点库（学公开「AI 剪辑进工作流」结构，成稿自写）。
 * 前台只露中性阶段名；与工厂出片、成片坞互补：本库定义粗剪轨上的阶段与检查项。
 */

export type ManhuaEditStageId =
  | "edit_understand"
  | "edit_rough_cut"
  | "edit_fine_cut"
  | "edit_subtitle"
  | "edit_motion"
  | "edit_qc"
  | "edit_rework"
  | "edit_export";

export type ManhuaEditStageEntry = {
  id: ManhuaEditStageId;
  no: number;
  nameZh: string;
  /** 一句话职责 */
  jobZh: string;
  /** 何时进入 */
  whenZh: string;
  /** 粗剪轨是否默认显示 */
  showOnRoughTimeline: boolean;
};

export const MANHUA_EDIT_STAGE_ORDER: readonly ManhuaEditStageId[] = [
  "edit_understand",
  "edit_rough_cut",
  "edit_fine_cut",
  "edit_subtitle",
  "edit_motion",
  "edit_qc",
  "edit_rework",
  "edit_export",
] as const;

export const MANHUA_EDIT_STAGE_BANK: readonly ManhuaEditStageEntry[] = [
  {
    id: "edit_understand",
    no: 1,
    nameZh: "理解",
    jobZh: "读节拍与分镜意图，标出必留信息点。",
    whenZh: "分镜文本就绪后、开剪前。",
    showOnRoughTimeline: false,
  },
  {
    id: "edit_rough_cut",
    no: 2,
    nameZh: "粗剪",
    jobZh: "按镜序排片段时长，去掉空镜与重复动作。",
    whenZh: "已有静帧或成片片段可排。",
    showOnRoughTimeline: true,
  },
  {
    id: "edit_fine_cut",
    no: 3,
    nameZh: "细剪",
    jobZh: "收紧进出点，对齐对白与情绪落点。",
    whenZh: "粗剪顺序确认后。",
    showOnRoughTimeline: true,
  },
  {
    id: "edit_subtitle",
    no: 4,
    nameZh: "字幕",
    jobZh: "对白条与样式匹配（成片烧字默认关闭，另轨可选）。",
    whenZh: "对白镜已定。",
    showOnRoughTimeline: true,
  },
  {
    id: "edit_motion",
    no: 5,
    nameZh: "包装",
    jobZh: "片头/转场/数据条等包装动效（可选）。",
    whenZh: "细剪稳定后。",
    showOnRoughTimeline: false,
  },
  {
    id: "edit_qc",
    no: 6,
    nameZh: "质检",
    jobZh: "角色/场景/剧情/运镜/时长五项核对。",
    whenZh: "导出前必过。",
    showOnRoughTimeline: true,
  },
  {
    id: "edit_rework",
    no: 7,
    nameZh: "返工",
    jobZh: "按质检问题回退到单镜静帧或单片段重出。",
    whenZh: "质检未过。",
    showOnRoughTimeline: false,
  },
  {
    id: "edit_export",
    no: 8,
    nameZh: "导出",
    jobZh: "合成长片进成片坞勾选。",
    whenZh: "质检通过。",
    showOnRoughTimeline: true,
  },
];

export type ManhuaRoughCutClip = {
  shotIndex: number;
  durationSec: number;
  labelZh: string;
  hasStill: boolean;
  hasClip: boolean;
  /** 粗剪顺序（可与镜号不同） */
  order: number;
};

export function buildRoughCutClipsFromShots(
  shots: Array<{ index: number; durationSec: number; actionZh?: string; cameraZh?: string }>,
  opts?: {
    stillIndexes?: Set<number>;
    clipIndexes?: Set<number>;
    order?: number[];
  },
): ManhuaRoughCutClip[] {
  const order = opts?.order?.length
    ? opts.order
    : shots.map((s) => s.index);
  const byIndex = new Map(shots.map((s) => [s.index, s]));
  return order
    .map((idx, i) => {
      const s = byIndex.get(idx);
      if (!s) return null;
      return {
        shotIndex: s.index,
        durationSec: Math.max(1, Number(s.durationSec) || 5),
        labelZh: (s.actionZh || s.cameraZh || `镜${s.index}`).slice(0, 24),
        hasStill: opts?.stillIndexes?.has(s.index) ?? false,
        hasClip: opts?.clipIndexes?.has(s.index) ?? false,
        order: i + 1,
      } satisfies ManhuaRoughCutClip;
    })
    .filter(Boolean) as ManhuaRoughCutClip[];
}

export function roughCutTotalSec(clips: ManhuaRoughCutClip[]): number {
  return clips.reduce((n, c) => n + c.durationSec, 0);
}

export function listRoughTimelineStages(): ManhuaEditStageEntry[] {
  return MANHUA_EDIT_STAGE_BANK.filter((s) => s.showOnRoughTimeline);
}

const STAGE_BY_ID = new Map(MANHUA_EDIT_STAGE_BANK.map((e) => [e.id, e]));

export function getManhuaEditStage(id: string | null | undefined): ManhuaEditStageEntry | null {
  if (!id) return null;
  return STAGE_BY_ID.get(id as ManhuaEditStageId) || null;
}
