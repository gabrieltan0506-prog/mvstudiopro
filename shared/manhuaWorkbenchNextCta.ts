/**
 * 对标阿硕 Story Studio：大纲 → 资产 → 分镜（+剪辑）。
 * 底栏只留「上一步 / 生成本步内容（或生成全部）」，文案与阶段页标题一致。
 */

export type ManhuaWorkbenchPhaseId = "outline" | "assets" | "storyboard" | "edit";

export type ManhuaWorkbenchNextCtaKind =
  | "confirm_outline"
  | "spawn_sheets"
  | "enter_storyboard"
  | "generate_keyarts"
  | "generate_all_clips"
  | "generate_clip"
  | "open_edit"
  | "busy"
  | "idle_done";

export type ManhuaWorkbenchNextCta = {
  kind: ManhuaWorkbenchNextCtaKind;
  /** 底栏主按钮（阿硕：生成本步内容 / 生成全部 / 生成分镜视频→） */
  labelZh: string;
  /** 当前阶段页标题（阿硕：生成本集角色设定卡…） */
  stepTitleZh: string;
  hintZh: string;
  targetPhase: ManhuaWorkbenchPhaseId;
  /** 上一步落点；大纲步为 null */
  prevPhase: ManhuaWorkbenchPhaseId | null;
};

export type ManhuaWorkbenchNextCtaInput = {
  outlineComplete: boolean;
  assetsComplete: boolean;
  /** 本集设定图墙张数（charsheet/sceneplate 有图） */
  episodeSheetCount: number;
  stillsReadyEnough: boolean;
  videoBurnUnlocked: boolean;
  hasClip: boolean;
  factoryBusy: boolean;
  factoryProgress?: string | null;
  writerPackReady?: boolean;
};

/** 根据进度算出唯一主操作（文案即按钮上的字） */
export function resolveManhuaWorkbenchNextCta(
  input: ManhuaWorkbenchNextCtaInput,
): ManhuaWorkbenchNextCta {
  if (input.factoryBusy) {
    return {
      kind: "busy",
      labelZh: "中断生成",
      stepTitleZh: "生成中",
      hintZh: String(input.factoryProgress || "").trim() || "请稍候，勿重复连点",
      targetPhase: "storyboard",
      prevPhase: "assets",
    };
  }

  if (!input.outlineComplete) {
    return {
      kind: "confirm_outline",
      labelZh: "生成本步内容",
      stepTitleZh: "剧本大纲",
      hintZh:
        input.writerPackReady === false
          ? "请先在「改题材」扩写或导入剧本"
          : "确认大纲后进入资产设定，再生成角色/场景设定卡",
      targetPhase: "outline",
      prevPhase: null,
    };
  }

  // 设定图墙为空时优先出卡（即使垫图分栏已绿）——对齐阿硕「生成全部」
  if (input.episodeSheetCount <= 0 || !input.assetsComplete) {
    return {
      kind: "spawn_sheets",
      labelZh: "生成全部",
      stepTitleZh: "生成本集角色设定卡",
      hintZh: "按剧本人物表与场景池出定妆/空镜；也可下方分区上传参考",
      targetPhase: "assets",
      prevPhase: "outline",
    };
  }

  if (!input.stillsReadyEnough || !input.videoBurnUnlocked) {
    return {
      kind: "generate_keyarts",
      labelZh: "生成关键静帧",
      stepTitleZh: "分镜 · 关键静帧",
      hintZh: "资产已齐：一次出齐本集关键静帧（导戏单随后自动生成）",
      targetPhase: "storyboard",
      prevPhase: "assets",
    };
  }

  if (!input.hasClip) {
    return {
      kind: "generate_all_clips",
      labelZh: "生成分镜视频 →",
      stepTitleZh: "分镜视频",
      hintZh: "静帧已齐：批量出各段成片（约 15 秒一镜）",
      targetPhase: "storyboard",
      prevPhase: "assets",
    };
  }

  return {
    kind: "open_edit",
    labelZh: "进入剪辑台",
    stepTitleZh: "剪辑",
    hintZh: "成片已有，可多轨剪辑或去成片坞合成",
    targetPhase: "edit",
    prevPhase: "storyboard",
  };
}
