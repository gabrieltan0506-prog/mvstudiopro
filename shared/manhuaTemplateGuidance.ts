import type { ManhuaTemplateMethodBrief } from "./manhuaViralTemplateBank";
import {
  TEMPLATE_CRAFT_RULES,
  type TemplateCraftProfile,
  type TemplateCraftId,
} from "./manhuaTemplateCraft";

/** Explanations of indexed methods, not claims about private source scenes or story suitability. */
export const CRAFT_USAGE: Record<TemplateCraftId, string> = {
  "choice-cost": "让人物为目标作出选择，并兑现损失或牺牲，推动下一场冲突。",
  "object-relationship": "让信物、文书或道具的交接、损毁改变人物的信任与立场。",
  "information-turn": "安排线索何时给谁看见，让信息差改变谈判筹码与局势。",
  "comic-counter": "在压力中用反差言语改变对手的反应，保留危险与人物目标。",
  "verbal-tactics":
    "让对白承担试探、隐瞒、威胁或交换条件，谈完后关系或筹码发生变化。",
  "silence-reply":
    "用停顿和未说出口的回应表现犹豫、防备或让步，避免直接解释心理。",
  "micro-reaction":
    "通过眼神、呼吸和细小动作呈现情绪变化，让反应推动对白与行动。",
  "contact-trust":
    "用接触、退避或接受帮助表达信任的改变，让关系转折落到动作上。",
  "action-response": "安排动作、受力与反应的先后，使观众看清行动的原因和后果。",
  "space-pressure": "用距离、高低与站位制造压迫，明确谁掌握主动、谁没有退路。",
  barrier: "借门窗、遮挡和空间阻隔呈现人物之间的隔绝或关系变化。",
  "group-reaction": "组织旁观者的目光与反应，突出主角行动如何改变全场局势。",
  "light-contrast": "用冷暖、明暗的对照突出冲突双方或转折前后的气氛差别。",
  "costume-contrast": "让服饰、妆容和色彩帮助观众辨认身份、处境与人物关系。",
  "light-emotion": "让光线服务面部表情与人物情绪，配合本场需要观众注意的变化。",
  "music-turn": "让音乐进入、变化或收束与人物决定和剧情转折相呼应。",
  "sound-space": "用环境声与脚步声交代空间、距离及画外动静，建立场景真实感。",
  "rhythm-contrast":
    "用快慢、动静或声音骤停制造转折，让关键反应有被看见的时间。",
};
export function templateGuidance(profile?: TemplateCraftProfile) {
  const ids = new Set(profile?.features.map(f => f.id) || []);
  return TEMPLATE_CRAFT_RULES.filter(f => ids.has(f.id)).map(
    ({ id, dimension, label }) => ({
      id,
      dimension,
      label,
      usage: CRAFT_USAGE[id],
    })
  );
}
export function suggestedTemplateRole(
  profile?: TemplateCraftProfile,
  brief?: ManhuaTemplateMethodBrief
) {
  if (brief)
    return `${brief.title}：${brief.highlights.join("；")}`.slice(0, 160);
  const methods = templateGuidance(profile);
  return methods.length
    ? `负责${methods
        .slice(0, 3)
        .map(f => f.label)
        .join("、")}`
    : "";
}
