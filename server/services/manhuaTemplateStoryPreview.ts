import { createHash } from "node:crypto";
import { MANHUA_TEMPLATE_STORY_PREVIEW_COPY } from "./manhuaTemplateStoryPreviewCopy.js";
import type { ManhuaViralTemplateCard, ManhuaTemplateStoryPreview } from "../../shared/manhuaViralTemplateBank.js";

/** 公开面只输出中性白名单文案；原剧情、后续反转和学习手法全文留在服务端。 */
const STORY_DIRECTIONS = [
  { name: "复仇与重生", pattern: /复仇|灭门|噩耗|仇人|仇恨|复仇立誓/, premise: "主角因突如其来的损失被迫重新面对自己的人生，追问真相也意味着承担新的代价。", opening: "平静被一个消息或遭遇打破，主角的反应让观众理解这份损失。", next: "主角开始决定如何走出眼前处境，更深的恩怨暂不揭开。" },
  { name: "绝境守护", pattern: /救|守护|保护|牺牲|献血|求生|生存/, premise: "身处危机的主角必须顾及自己和身边的人，但保护他人会让处境更难。", opening: "危险已经逼近，主角先作出一个让人看懂的保护或求生选择。", next: "眼前困境暂未解除，人与人之间的信任和代价开始浮现。" },
  { name: "身份与立威", pattern: /身份|立威|晋升|盘问|新官|扮猪吃虎|打脸|测评/, premise: "主角的能力或身份被质疑，试探与挑衅让一次普通相遇变成较量。", opening: "主角面对审视或挑衅，表面反应与真实底气形成反差。", next: "一次试探引出更大的压力；主角如何回应，仍留给正式故事展开。" },
  { name: "悬疑与追查", pattern: /悬疑|线索|谜|诡异|真相|伪装|探案|秘密|揭秘/, premise: "看似普通的处境出现异常，主角试图弄清发生了什么，却越查越不安。", opening: "先让观众注意到一个异常或信息缺口，而非提前解释谜底。", next: "新的迹象与原有判断发生冲突，问题刚变得更复杂。" },
  { name: "权谋与博弈", pattern: /权谋|政争|政治|官场|利诱|利益交换|谈判|阵营|攻心/, premise: "主角必须在相互牵制的关系中行动，每次表态都可能暴露自己的处境。", opening: "一段看似平静的交谈带出警告、试探或无法回避的要求。", next: "言语背后的立场渐渐显露，主角还没有作出最终选择。" },
  { name: "反抗与自救", pattern: /压迫|羞辱|欺凌|霸凌|家族|深宅|女性独立|自救|阶级|反抗/, premise: "主角被规则或关系束缚，必须在忍受与反抗之间找到自己的出路。", opening: "先让不公平的处境可见，主角的一个反应显露不肯屈服的底线。", next: "冲突触碰更深的关系与代价，出路尚未揭晓。" },
  { name: "战斗与强敌", pattern: /战斗|对峙|强敌|出征|反杀|绝地反击|决战|战争/, premise: "主角面对难以轻易战胜的对手，行动暴露双方真实的力量差距。", opening: "通过对峙或危险的逼近，让观众先看懂双方处境。", next: "原有应对受到挑战，主角必须决定下一步如何行动。" },
  { name: "觉醒与成长", pattern: /系统|觉醒|异变|升级|修炼|世界观|能力获得|资源匮乏|资源困局|变强|成长|奇遇|积累/, premise: "主角从困顿或能力不足的处境出发，新的可能性同时带来新的约束。", opening: "一个异常或困境打破日常，主角开始察觉自己必须作出改变。", next: "眼前的能力或资源缺口逐渐显露，如何弥补仍待故事展开。" },
  { name: "情感与抉择", pattern: /亲情|母女|主仆|爱情|甜宠|救赎|托孤|诀别|亏欠|信任/, premise: "亲近的人之间出现难以回避的困境，感情必须通过选择和代价来证明。", opening: "让人物关系和眼前难题同时出现，情绪来自可见的行动。", next: "一个选择影响另一人的回应，关系的去向尚未揭开。" },
  { name: "反差与讽刺", pattern: /讽刺|荒诞|喜剧|沙雕|反差|搞笑|幽默|滑稽|解构|自嘲/, premise: "人物的外在表现与真实处境发生错位，一场冲突因此带出反差。", opening: "先建立一本正经的处境，再让一个不相称的反应改变观众预期。", next: "反差开始影响人物关系，后续如何收束暂不展示。" },
] as const;

const PRESENTATION = [
  { label: "反应与停顿", pattern: /微表情|眼神|停顿|内心|反应/ },
  { label: "信息悬念", pattern: /信息差|延迟|隐藏|悬念|遮蔽|留白/ },
  { label: "对白交锋", pattern: /正反打|言语|对白|谈判|盘问|耳语/ },
  { label: "空间压迫", pattern: /体型差|仰拍|站位|纵深|压迫|逼近/ },
  { label: "动静反差", pattern: /动静|快慢|瞬间|突然|爆发|静止/ },
  { label: "声音牵引", pattern: /声画|静默|声音|音效|低频|死寂/ },
  { label: "视角对照", pattern: /侧面|视角|群像|交叉|对照|对比/ },
  { label: "动作因果", pattern: /动作|受力|打击|反击|行动|肢体/ },
] as const;

function score(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, "g")) || []).length;
}

/** 仅用开篇证据判故事方向；手法只公开两个侧重标签，绝不返回原字段的切片。 */
export function buildManhuaTemplateStoryPreview(card: ManhuaViralTemplateCard): ManhuaTemplateStoryPreview | undefined {
  if (card.status !== "approved") return undefined;
  const early = [card.hook3sZh, ...card.beatGrid.slice(0, 3).flatMap(b => [b.conflictZh, b.visualZh])].join("\n");
  if (!early.trim() || /^(?:待补|未分析|未知|无证据)[\s：:]*$/.test(early.trim())) return undefined;
  const narrative = (card.classification?.narrativeFeatureTagsZh || []).join("；");
  const direction = STORY_DIRECTIONS.map((entry, index) => ({ entry, index, weight: score(early, entry.pattern) * 4 + score(narrative, entry.pattern) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)[0];

  const craft = [card.reusableZh, ...(card.classification?.audiovisualTagsZh || []), ...(card.classification?.performanceTagsZh || [])].join("；");
  const approaches = PRESENTATION.map((entry, index) => ({ entry, index, weight: score(craft, entry.pattern) }))
    .filter(x => x.weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index).slice(0, 2).map(x => x.entry.label);
  const copy = MANHUA_TEMPLATE_STORY_PREVIEW_COPY[String(card.publicCode || "").trim().toUpperCase()];
  const evidence = createHash("sha256").update(JSON.stringify({
    hook: card.hook3sZh, summary: card.summaryZh,
    narrative: card.classification?.narrativeFeatureTagsZh || [],
    early: card.beatGrid.slice(0, 3).map(b => ({ conflictZh: b.conflictZh, visualZh: b.visualZh })),
  })).digest("hex");
  if (copy?.evidenceSha256 === evidence) return {
    storyTypeZh: copy.storyTypeZh, teaserTitleZh: copy.teaserTitleZh,
    premiseZh: copy.premiseZh, openingZh: copy.openingZh,
    earlyProgressionZh: copy.earlyProgressionZh, presentationTagsZh: approaches,
  };
  if (!direction?.weight) return undefined;
  return {
    storyTypeZh: direction.entry.name,
    premiseZh: direction.entry.premise,
    openingZh: direction.entry.opening,
    earlyProgressionZh: direction.entry.next,
    presentationTagsZh: approaches,
  };
}
