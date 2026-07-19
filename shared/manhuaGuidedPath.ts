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
