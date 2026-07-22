/**
 * 工作台「当前该点」主 CTA：一步一个大按钮，避免提示与真实按钮名错位。
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
  labelZh: string;
  hintZh: string;
  targetPhase: ManhuaWorkbenchPhaseId;
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
      labelZh: "生成中…可点中断",
      hintZh: String(input.factoryProgress || "").trim() || "请稍候，勿重复连点",
      targetPhase: "storyboard",
    };
  }

  if (!input.outlineComplete) {
    return {
      kind: "confirm_outline",
      labelZh: "确认大纲，进入资产设定",
      hintZh: input.writerPackReady === false
        ? "请先在「改题材」扩写或导入剧本"
        : "确认后会打开「资产设定」并出现设定图生成按钮",
      targetPhase: "outline",
    };
  }

  // 设定图墙为空时优先出卡（即使垫图分栏已绿）
  if (input.episodeSheetCount <= 0) {
    return {
      kind: "spawn_sheets",
      labelZh: "生成本集角色/场景设定图",
      hintZh: "打开「资产设定」→ 点本按钮出角色定妆与场景空镜",
      targetPhase: "assets",
    };
  }

  if (!input.assetsComplete) {
    return {
      kind: "spawn_sheets",
      labelZh: "生成本集角色/场景设定图",
      hintZh: "角色/场景图未齐：继续补设定图或上传参考后再进分镜",
      targetPhase: "assets",
    };
  }

  if (!input.stillsReadyEnough) {
    return {
      kind: "generate_keyarts",
      labelZh: "确认简报，生成分镜画面",
      hintZh: "资产已齐：一次出齐本集关键静帧",
      targetPhase: "storyboard",
    };
  }

  if (!input.videoBurnUnlocked) {
    return {
      kind: "generate_keyarts",
      labelZh: "确认简报，生成分镜画面",
      hintZh: "静帧或导戏单未齐时先补静帧；导戏单会在静帧后自动生成",
      targetPhase: "storyboard",
    };
  }

  if (!input.hasClip) {
    return {
      kind: "generate_all_clips",
      labelZh: "确认静帧，生成全部成片",
      hintZh: "静帧已齐：批量出各段成片（约 15 秒一镜）",
      targetPhase: "storyboard",
    };
  }

  return {
    kind: "open_edit",
    labelZh: "进入剪辑台",
    hintZh: "成片已有，可多轨剪辑或去成片坞合成",
    targetPhase: "edit",
  };
}
