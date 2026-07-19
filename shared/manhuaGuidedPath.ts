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
  { id: "wb", label: "工作台", href: "#manhua-workbench-zone" },
  { id: "keyart", label: "静帧", href: "#manhua-workbench-zone" },
  { id: "clip", label: "成片", href: "#manhua-clip-dock-zone" },
  { id: "preview", label: "预览", href: "#manhua-clip-dock-zone" },
];

export type ManhuaGuidedProgress = {
  hasTopic: boolean;
  hasWriterPack: boolean;
  writerConfirmed: boolean;
  hasCast: boolean;
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
      title: "跑成本集成片",
      hint: "静帧已出，继续生成微动成片。",
      ctaLabel: "去工作台生成",
      href: "#manhua-workbench-zone",
    };
  }
  if (p.writerConfirmed && p.hasCast) {
    if (!p.hasFactoryChain) {
      return {
        stepId: "wb",
        title: "铺板并出片",
        hint: "造型已套好；在工作台点「生成本集成片」会自动铺节点并开跑。",
        ctaLabel: "打开工作台出片",
        href: "#manhua-workbench-zone",
      };
    }
    return {
      stepId: "wb",
      title: "进入工作台出片",
      hint: "节点已铺好，生成本集静帧与成片。",
      ctaLabel: "打开工作台",
      href: "#manhua-workbench-zone",
    };
  }
  if (p.writerConfirmed) {
    return {
      stepId: "cast",
      title: "确认造型",
      hint: "可打开角色库微调面孔与画风。",
      ctaLabel: "打开角色库",
      href: "#manhua-cast-zone",
    };
  }
  if (p.hasWriterPack) {
    return {
      stepId: "writer",
      title: "确认编剧",
      hint: "剧情包已出，确认后自动套造型并解锁工作台。",
      ctaLabel: "回到编剧室确认",
      href: "#manhua-factory-zone",
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
