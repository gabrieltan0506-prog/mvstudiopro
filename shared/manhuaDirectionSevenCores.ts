import { MANHUA_PERFORMANCE_CRAFT_ZH, MANHUA_PERFORMANCE_REVIEW_ZH } from "./manhuaPerformanceCraft.js";
/** 用户提供的七核心教学图转为决策检查项，不冒充某位导演的考据规律。 */
export const MANHUA_SHOT_CORE_GUIDES = [
  { key: "scale", labelZh: "景别", instructionZh: "按本镜信息量选择远景、全景、中景、近景或细节特写；空间与多人动作需看清关系，情绪和关键线索才收近，避免整段只用近景。" },
  { key: "angle", labelZh: "角度", instructionZh: "按观众视点选择平视、仰拍、俯拍、侧面、过肩或特殊机位；注明视线与轴线，不把仰拍固定等同强者，也不混用互斥机位。" },
  { key: "composition", labelZh: "构图", instructionZh: "从三分、居中、引导线、框架、对角、对称、留白中按叙事选一种主构图，写明主体、前中后景与关注点，保留关键互动对象。" },
  { key: "lighting", labelZh: "光影", instructionZh: "说明实际光源、方向、软硬与明暗关系；顺光、侧光、逆光、顶光、底光或伦勃朗式塑形须有场景依据，同场保持光向，重要表情可辨。" },
  { key: "palette", labelZh: "色调", instructionZh: "沿用已确认场景及服装颜色，在暖、冷、中性、饱和度、对比或单色倾向中选择；写清情绪目的与允许变化，不因换镜任意改色。" },
  { key: "dynamics", labelZh: "动势", instructionZh: "分开写人物动作、摄影机运动与特效方向；水平、垂直、对角、曲线、放射、螺旋或S形依剧情选择，交代起止位置、目标、快慢区间和动作结果，不能用镜头移动代替人物动作。" },
  { key: "transition", labelZh: "转场", instructionZh: "说明与下一镜的因果或时空关系；连贯动作优先直接切或动作匹配，有依据才用淡变、叠化、闪白黑、划像、推拉衔接、匹配剪辑或蒙太奇；蒙太奇须拆成实际镜头，推拉本身不是时空连续性的证明。" },
] as const;

export function manhuaSevenCoreDirectives(stage: "storyboard" | "keyframe" | "clip" | "review"): string[] {
  const cores = stage === "keyframe" ? MANHUA_SHOT_CORE_GUIDES.slice(0, 5) : MANHUA_SHOT_CORE_GUIDES;
  if (stage === "review") return [MANHUA_PERFORMANCE_REVIEW_ZH, ...cores.map(c => `七核心检查·${c.labelZh}：对照本镜已确认方案与实际产物；缺少证据标未验证，发现问题定位镜号与受影响项，不凭任务成功判通过。${c.instructionZh}`)];
  return [
    "七核心落实：以下为通用分镜决策检查项，不是导演生平规律；结合本阶段选卡手法与本镜剧情填写，用户明确锁定优先，没有依据不强加风格。",
    ...(stage === "keyframe" ? [] : [MANHUA_PERFORMANCE_CRAFT_ZH.replace(/\s*\n\s*/g, " ")]),
    ...cores.map(c => `${c.labelZh}：${c.instructionZh}`),
    stage === "keyframe"
      ? "静帧只呈现已选时刻的构图、机位、光色及主体姿态，不生成时间过程或切镜效果。"
      : "逐镜沿用既有镜号与时长，把选择及叙事理由写回现有分镜描述；不得为凑齐七项增加镜头或改动已确认剧情。",
  ];
}
