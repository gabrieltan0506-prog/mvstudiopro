import { z } from "zod";

export const previsProxyColorSchema = z.tuple([
  z.number().finite().min(0).max(1), z.number().finite().min(0).max(1), z.number().finite().min(0).max(1),
]);
/** 仅用于球头圆柱几何示意，不改写真实模型材质。 */
export const previsProxyAppearanceSchema = z.object({
  style: z.literal("ball-cylinder"),
  colors: z.array(z.object({ timeSec: z.number().finite().min(0).max(30), color: previsProxyColorSchema }).strict()).min(2).max(16),
}).strict();
export type PrevisProxyAppearance = z.infer<typeof previsProxyAppearanceSchema>;
export const PREVIS_PROXY_PROP_KINDS = ["task_avatar", "light_orb", "information_panel", "code_screen", "stage_box"] as const;
export function isPrevisProxyProp(kind: string): boolean {
  return (PREVIS_PROXY_PROP_KINDS as readonly string[]).includes(kind);
}
export const previsProxyPropGeometrySchema = z.object({
  size: z.tuple([z.number().finite().min(.02).max(8), z.number().finite().min(.02).max(8), z.number().finite().min(.02).max(8)]),
  color: previsProxyColorSchema,
  /** 拉丁短标签只用于白模定位，正式字幕仍由最终输入单独控制。 */
  label: z.string().regex(/^[A-Za-z0-9 _:.+-]{0,40}$/).optional(),
}).strict();
export function previsProxyColorAt(appearance: PrevisProxyAppearance, t: number): [number, number, number] {
  const keys = appearance.colors;
  if (t <= keys[0].timeSec) return [...keys[0].color];
  for (let i=0; i<keys.length-1; i++) {
    const a=keys[i], b=keys[i+1];
    if (t < b.timeSec) {
      const u=(t-a.timeSec)/(b.timeSec-a.timeSec);
      return a.color.map((v,j)=>v*(1-u)+b.color[j]*u) as [number,number,number];
    }
  }
  return [...keys.at(-1)!.color];
}
export function previsProxyAppearanceIssue(appearance: PrevisProxyAppearance, durationSec: number, shape: string, rigged: boolean): string | null {
  if (shape!=="human" || rigged) return "球头圆柱换色只用于无真实模型的人形几何白模";
  const keys=appearance.colors;
  if (keys[0].timeSec!==0 || keys.at(-1)!.timeSec!==durationSec) return "几何白模换色须保留整段首尾状态";
  if (keys.some((k,i)=>k.timeSec>durationSec || Math.abs(k.timeSec*24-Math.round(k.timeSec*24))>1e-6 || (i>0 && k.timeSec<=keys[i-1].timeSec))) return "几何白模换色须按24帧严格递增且不超片长";
  return null;
}
