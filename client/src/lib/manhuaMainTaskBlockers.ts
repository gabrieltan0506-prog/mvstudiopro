/**
 * 「阻断卡集中显示」：把散落各处的阻断项收成一张卡，接在唯一主任务条下面（纯函数层）。
 *
 * 线上问题（README + 对照图「状态与交互必须一并实现」）：阻断信息只在阶段条旁边挤出
 * 一条 220px 截断的「顾问：…」，用户既不知道一共卡着几条，也不知道先解哪条；
 * 而主操作按钮点下去才被门禁拦住。
 *
 * 分级已经有了（`AdvisorIssue.blocking`，8 条阻断 / 3 条提醒）。这里只做两件事：
 * 1. 排序：**当前阶段的阻断项排最前** —— 用户此刻能就地解掉的那些；
 * 2. 说清后果：阻断 = 现在往下走会被拦；提醒 = 可以继续，但要知道代价。
 *
 * 不做的事：不改门禁判据、不替用户点任何按钮、不隐藏提醒项（藏提示是线上那个毛病本身）。
 */
import type { AdvisorIssue } from "./manhuaAdvisorProject";

export type ManhuaMainTaskState = {
  /** 此刻是否有阻断项（生成中不算：那时主操作是「中断」，不是「往下走」） */
  blocked: boolean;
  /** 阻断项，当前阶段优先 */
  blockers: AdvisorIssue[];
  /** 提醒项，当前阶段优先；不阻断但要显示 */
  advisories: AdvisorIssue[];
  /** 卡头一行：说清卡着几条、先解哪条 */
  headlineZh: string;
  /** 没有阻断时给空串（卡整张不渲染） */
  hintZh: string;
};

function phaseFirst(issues: readonly AdvisorIssue[], phase: string): AdvisorIssue[] {
  return [...issues.filter((i) => i.phase === phase), ...issues.filter((i) => i.phase !== phase)];
}

/** 只说明处理入口，不执行生成，也不改变任何校验结果。 */
export function manhuaIssueResolutionZh(issue: AdvisorIssue): string {
  const actions: Record<string, string> = {
    script: "导入或填写本集剧本，再确认正文。",
    canon: "核对并确认剧本人物表，再认领人物参考图。",
    engine: "选择本集成片引擎。",
    "engine-conflict": "核对本集成片节点，统一成片引擎。",
    gate: "打开剧本检查，按列出的要求修改后重新核对。",
    scene: "确认场景表，或选择可用的场景参考图。",
    "asset-gap": "进入资产设定，补齐列出的缺失参考。",
    keyframe: "进入分镜核对对应镜头：缺图时补图；版本不一致时先核对画面和造型，确有变化再重出该镜；仅改对白或时长时应核查版本记录。",
  };
  return actions[issue.id] || "打开对应步骤，按这项检查的要求处理后重新核对。";
}

export function buildManhuaMainTaskState(input: {
  issues: readonly AdvisorIssue[];
  /** 当前阶段 id */
  phase: string;
  /** 正在生成：此刻主操作是中断，阻断卡不抢它的位置 */
  busy?: boolean;
}): ManhuaMainTaskState {
  const blockers = phaseFirst(input.issues.filter((i) => i.blocking), input.phase);
  const advisories = phaseFirst(input.issues.filter((i) => !i.blocking), input.phase);
  const blocked = blockers.length > 0 && !input.busy;
  const thisPhase = blockers.filter((i) => i.phase === input.phase).length;
  return {
    blocked,
    blockers,
    advisories,
    headlineZh: blocked
      ? thisPhase > 0
        ? `本步待核对 ${thisPhase} 项`
        : `制作待核对 ${blockers.length} 项`
      : "",
    hintZh: blocked ? "查看未通过项与处理办法，点击进入对应步骤" : "",
  };
}
