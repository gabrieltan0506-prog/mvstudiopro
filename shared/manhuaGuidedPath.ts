/**
 * 示意 A · 引导式实测路径（整页地基状态机）
 */
export type ManhuaGuidedStepId =
  | "topic"
  | "writer"
  | "cast"
  | "card"
  | "wb"
  | "keyart"
  | "clip"
  | "preview";

export const MANHUA_GUIDED_STEPS: ReadonlyArray<{
  id: ManhuaGuidedStepId;
  label: string;
  href: string;
}> = [
  { id: "topic", label: "题材", href: "#manhua-factory-zone" },
  { id: "writer", label: "编剧", href: "#manhua-factory-zone" },
  { id: "cast", label: "自动套", href: "#manhua-cast-zone" },
  { id: "card", label: "角色卡", href: "#manhua-cast-zone" },
  { id: "wb", label: "工作台", href: "#manhua-live-progress-zone" },
  { id: "keyart", label: "静帧", href: "#manhua-live-progress-zone" },
  { id: "clip", label: "成片", href: "#manhua-live-progress-zone" },
  { id: "preview", label: "预览", href: "#manhua-clip-dock-zone" },
];

export type ManhuaGuidedProgress = {
  hasTopic: boolean;
  hasWriterPack: boolean;
  writerConfirmed: boolean;
  hasCast: boolean;
  /** 人物+场景参考已齐（库或自传），可进分镜 */
  assetsReady?: boolean;
  /** 画布已有工厂链（已铺板） */
  hasFactoryChain?: boolean;
  hasKeyart: boolean;
  hasClip: boolean;
  hasFinalVideo: boolean;
};

export function resolveManhuaGuidedActiveStep(p: ManhuaGuidedProgress): ManhuaGuidedStepId {
  if (p.hasFinalVideo) return "preview";
  if (p.hasClip) return "clip";
  if (p.hasKeyart) return "keyart";
  if (p.writerConfirmed && p.hasCast) return "wb";
  if (p.writerConfirmed) return "cast";
  if (p.hasWriterPack) return "writer";
  if (p.hasTopic) return "topic";
  return "topic";
}

export type ManhuaGuidedNextAction = {
  stepId: ManhuaGuidedStepId;
  title: string;
  hint: string;
  ctaLabel: string;
  href: string;
};

/** 当前应点的下一步（整页「下一步」条用） */
export function resolveManhuaGuidedNextAction(p: ManhuaGuidedProgress): ManhuaGuidedNextAction {
  if (p.hasFinalVideo) {
    return {
      stepId: "preview",
      title: "长片已就绪",
      hint: "可在成片坞预览与导出工程包。",
      ctaLabel: "查看成片坞",
      href: "#manhua-clip-dock-zone",
    };
  }
  if (p.hasClip) {
    return {
      stepId: "preview",
      title: "合成长片",
      hint: "各集微动已有产出，可一键拼接并自动配乐。",
      ctaLabel: "去成片坞合成",
      href: "#manhua-clip-dock-zone",
    };
  }
  if (p.hasKeyart) {
    return {
      stepId: "clip",
      title: "确认静帧，生成片段成片",
      hint: "分镜静帧已出；在工作台确认后按镜出视频（一镜一图一片）。",
      ctaLabel: "确认静帧，生成片段成片",
      href: "#manhua-workbench-zone",
    };
  }
  if (p.writerConfirmed && p.hasCast) {
    if (!p.assetsReady) {
      return {
        stepId: "wb",
        title: "确认资产并出图",
        hint: "请上传勾选人物/场景，或从库选择后确认资产，再进分镜。",
        ctaLabel: "确认资产并出图",
        href: "#manhua-workbench-zone",
      };
    }
    if (!p.hasFactoryChain) {
      return {
        stepId: "wb",
        title: "确认简报，生成分镜画面",
        hint: "资产已齐；到工作台确认视觉简报后一次出齐本集静帧。",
        ctaLabel: "确认简报，生成分镜画面",
        href: "#manhua-workbench-zone",
      };
    }
    return {
      stepId: "keyart",
      title: "确认简报，生成分镜画面",
      hint: "节点已铺好；确认视觉简报后生成分镜静帧，再出成片。",
      ctaLabel: "确认简报，生成分镜画面",
      href: "#manhua-workbench-zone",
    };
  }
  if (p.writerConfirmed) {
    return {
      stepId: "cast",
      title: "确认造型",
      hint: "可打开角色库微调面孔与画风，或上传参考图。",
      ctaLabel: "打开角色库",
      href: "#manhua-cast-zone",
    };
  }
  if (p.hasWriterPack) {
    return {
      stepId: "writer",
      title: "确认编剧",
      hint: "剧情包已出；确认后进入资产设定与分镜。",
      ctaLabel: "确认剧情，进入资产设定",
      href: "#manhua-workbench-zone",
    };
  }
  if (p.hasTopic) {
    return {
      stepId: "topic",
      title: "扩写剧情",
      hint: "题材已填，点「扩写剧情」生成连载包。",
      ctaLabel: "去编剧室扩写",
      href: "#manhua-factory-zone",
    };
  }
  return {
    stepId: "topic",
    title: "填写题材",
    hint: "先写一句话题材与三到五句条件。",
    ctaLabel: "去填题材",
    href: "#manhua-factory-zone",
  };
}
