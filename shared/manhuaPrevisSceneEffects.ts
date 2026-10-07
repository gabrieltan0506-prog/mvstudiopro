import { z } from "zod";
const base = { id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), actorId: z.string().min(1).max(100) };
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const wind = z.number().finite().min(-3).max(3);
export const previsSceneEffectSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("cape"), width: z.number().finite().min(0.2).max(2), length: z.number().finite().min(0.2).max(3), color, wind: z.tuple([wind, wind, wind]) }).strict(),
  z.object({ ...base, kind: z.literal("explode"), distance: z.number().finite().min(0.05).max(2), startSec: z.number().finite().min(0).max(8), durationSec: z.number().finite().min(1 / 24).max(8) }).strict(),
  z.object({ ...base, kind: z.literal("hologram"), color, intensity: z.number().finite().min(0.1).max(2) }).strict(),
  z.object({ ...base, kind: z.literal("attribute_color"), color, colorEnd: color }).strict(),
  z.object({ ...base, kind: z.literal("label"), bone: z.enum(["head", "spine", "pelvis", "hand-1", "hand1"]),
    text: z.string().trim().min(1).max(32).regex(/^[^\x00-\x1f\x7f]+$/), color,
    offset: z.tuple([z.number().finite().min(-2).max(2), z.number().finite().min(-2).max(2), z.number().finite().min(-2).max(2)]),
    fontSize: z.number().finite().min(0.06).max(0.4) }).strict(),
]);
export const previsSceneEffectsSchema = z.array(previsSceneEffectSchema).max(4);
export type PrevisSceneEffect = z.infer<typeof previsSceneEffectSchema>;
export const PREVIS_SCENE_EFFECT_LABELS: Record<PrevisSceneEffect["kind"], string> = {
  cape: "披风布料", explode: "模型分件展开", hologram: "灵体材质", attribute_color: "属性渐变材质",
  label: "骨骼跟随标注",
};
export function validatePrevisSceneEffects(spec: { durationSec: number; actors: Array<{ id: string; shape: string }>; sceneEffects?: PrevisSceneEffect[] }, ctx: z.RefinementCtx) {
  const effects = spec.sceneEffects;
  if (!effects?.length) return;
  const issue = (message: string, index?: number) => ctx.addIssue({ code: "custom", path: ["sceneEffects", ...(index === undefined ? [] : [index])], message });
  if (spec.durationSec > 8 || spec.actors.length > 3) issue("场景特效限3个角色、8秒以内");
  if (effects.filter(e => e.kind === "cape").length > 1) issue("同段最多模拟一件披风");
  if (effects.some(e => e.kind === "cape") && effects.some(e => e.kind === "explode")) issue("披风碰撞与模型分件展开需要分开预演");
  const ids = new Set<string>(), materials = new Set<string>(), actorKinds = new Set<string>();
  effects.forEach((effect, i) => {
    if (ids.has(effect.id)) issue("场景特效编号重复", i);
    ids.add(effect.id);
    const actorKind = JSON.stringify([effect.actorId, effect.kind]);
    if (actorKinds.has(actorKind)) issue("同一角色不能重复添加相同效果", i);
    actorKinds.add(actorKind);
    const actor = spec.actors.find(a => a.id === effect.actorId);
    if (!actor) issue("请选择本段存在的角色", i);
    if (effect.kind === "cape" && actor?.shape !== "human") issue("披风需要当前人体骨架", i);
    if (effect.kind === "explode" && effect.startSec + effect.durationSec > spec.durationSec + 1e-9) issue("分件展开超出本段时长", i);
    if (effect.kind === "hologram" || effect.kind === "attribute_color") {
      if (materials.has(effect.actorId)) issue("同一角色只能选择一种材质效果", i);
      materials.add(effect.actorId);
    }
  });
}
export function formatPrevisSceneEffectsGuide(effects: PrevisSceneEffect[] | undefined, actors: Array<{ id: string; nameZh: string }>) {
  return (effects || []).map(effect => {
    const name = actors.find(actor => actor.id === effect.actorId)?.nameZh || effect.actorId;
    if (effect.kind === "explode") return `${name}的独立模型部件在${effect.startSec}—${effect.startSec + effect.durationSec}秒按参考展开；不凭空补造内部结构。`;
    if (effect.kind === "cape") return `${name}的披风按参考中的挂点与褶皱运动，保留正式角色外观。`;
    if (effect.kind === "label") return `${name}的“${effect.text}”标注用于说明对应部位，不将说明文字画入正式角色外观。`;
    return `${name}采用参考中的${effect.kind === "hologram" ? "半透明发光轮廓" : "上下渐变材质"}，不继承预演人偶造型。`;
  });
}
