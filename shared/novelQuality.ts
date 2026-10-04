import { inspectFragmentedDialogue } from "./manhuaNovelAdaptation";

export const NOVEL_CONTINUITY_RULES = `返回前核对场景的日期、时辰与动作先后：约定、赴约、违约判断、后果必须按因果排序。酉时约17–19时；“明晚赴约，违约则明早处置”把后果放在条件之前，不得这样写。跨午夜、闪回或不同说话日期须明确标记，不能混用相对日期。若已确认稿有冲突，在说明中指出具体句子与影响，不静默改写已确认事实。
学的是模板的节奏与呈现方式：空间站位、人物动作与关系变化、妆造道具、灯光色彩、声音和氛围都应按当前场面取用。不要把这些退化成题材套路；没有学习依据的手法不冒称来源。对白不设五字上限，也不设统一最低字数，保留完整诉求、回应和潜台词。`;

/** Conservative editing hints, not exhaustive semantic validation. Never discard or regenerate text. */
export function inspectNovelQuality(
  text: string
): { kind: string; message: string; excerpt?: string }[] {
  const issues: { kind: string; message: string; excerpt?: string }[] = [];
  const dialogue = inspectFragmentedDialogue(text);
  if (dialogue.fragmented)
    issues.push({
      kind: "fragmented-dialogue",
      message: `检测到${dialogue.lines}个带引号对白回合，其中${dialogue.shortLines}个不超过五字。请核对是否缺少完整诉求与回应；短句本身不是错误。`,
    });
  const pattern =
    /明(?:晚|日酉时|天(?:傍晚|晚上|酉时))[^\n。！？]{0,100}(?:敢|若|如果|否则|不然|违约)[^\n。！？]{0,60}明(?:早|晨)/g;
  for (const match of Array.from(text.matchAll(pattern)))
    issues.push({
      kind: "time-order",
      excerpt: match[0],
      message:
        "此处疑似把明晚约定的后果写在明早。请核对说话日期、赴约与违约判断顺序；若是回忆或另一日说话，需写明。",
    });
  return issues;
}
