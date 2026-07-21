/**
 * 漫剧叙事引擎：目标·阻力·代价 / 前三秒钩子 / 信息增量 / 场次可拍模板。
 * 学公开短视频剧本框架结构，成稿自写；前台不露外站名。
 */

import { composeManhuaEpisodeQualityBlock } from "./manhuaEpisodeQualityPrompt.js";

/** 剧情发动机：目标 → 阻力 → 代价 */
export const MANHUA_PLOT_ENGINE_BLOCK = `【剧情发动机·必填】
推动剧情靠三件事写清：
A 目标：主角本集必须拿到什么？（具体）
B 阻力：谁/什么在挡？（真实可拍）
C 代价：失败会失去什么？（让人紧张）
公式：目标 → 阻力 → 代价 = 剧情发动机。
无目标易散；无阻力与代价难留人。`;

/** 前三秒钩子 */
export const MANHUA_HOOK_3S_BLOCK = `【前三秒钩子】
强开头不必夸张台词，要立刻给：问题 / 异常 / 冲突 / 悬念之一。
写法顺序：先给问题 → 再给异常 → 制造冲突 → 给结果预感 → 画面可拍（动作·声音·镜头变化，少抽象说明）。
禁止平淡开场（上班、起床、闲聊天气）。首镜必须可拍可见。`;

/** 每段信息增量 */
export const MANHUA_INFO_INCREMENT_BLOCK = `【信息增量】
每一镜/每一段必须至少新增一类：新信息｜新冲突｜新关系｜新危机｜新转折｜新结果。
禁止整段重复解释；好节拍不是加字数，而是信息、关系与风险持续升级。`;

/** 场次脚本字段（可拍） */
export const MANHUA_SCENE_SCRIPT_FIELDS_BLOCK = `【场次可拍字段】
每场尽量写清：场次｜时长｜场景（时·内外·地点·天气状态）｜人物｜画面（多拍动作链+人物互动）｜对白｜镜头（景别+运镜序列）｜声音｜转场｜氛围突变中介｜生成备注（服装发型灯光连续）。
自检：冲突是否开场成立｜目标阻力代价是否清楚｜每拍是否有变化｜对白是否推动关系｜主角与他人互动是否可读｜情绪是否变成可见动作｜天气/戏种跳变是否有过渡与引爆点｜结尾是否留钩子。`;

/** 少心理多动作 */
export const MANHUA_VISIBLE_ACTION_BLOCK = `【可拍改写】
少写抽象心理，多写动作、表情、道具、站位、声音与镜头变化。
例：勿写「她很害怕」→ 写「后退半步，手指死死抓住门把，视线越过对方肩膀寻找走廊出口」。
对白要一句一拳；道具须承担信息（合同/车票/聊天记录等），勿纯装饰。`;

/** 短剧默认节奏（三分钟一集 ≈ 12 段） */
export const MANHUA_SHORT_DRAMA_ARC_BLOCK = `【短剧默认弧·三分钟】
整集约 180 秒（约 12 段 × 15 秒）：
0–15 秒：压力/冲突/反差钩子；
中段（约 6–8 段）：目标受阻、人物互动升级、道具/身份信息兑现、可含对白→肢体冲突的引爆；
后段：证据或关系反转（可叠加天气/氛围突变服务剧情）；
结尾段：爽点或悬念回扣，触发追更。
同场可多事件：对白、互动、打斗、天气变化须可拍过渡，禁止硬切湿透或无引爆点开打。
对白须推动关系；道具须入画；每段有运镜起落与动作链；场景材质光色可变压但须有中介镜。`;

/** 成片侧（图生视频）降废片约束——学竞品工作流结构，不写外站名 */
export const MANHUA_CLIP_PREFLIGHT_BLOCK = `【成片预演硬锁】
1. 形象连续：本段人物发型服装与已锁定静帧一致，禁止换脸换装。
2. 先静帧后成片：无静帧勿空想整段视频。
3. 运镜一次一事：本段主运镜 1 种，写清起幅→落幅；勿堆叠甩镜+升降+手持。
4. 时长对齐本段秒数（约 15 秒/段）；禁止按旧版整集短时长灌水。
5. 台词只驱动口型气口，画面无字幕。
6. 落实段内多拍动作链、人物互动与道具交互；场景纵深与光色对齐参考静帧；天气/戏种突变须有可见过渡。`;

export function composeManhuaNarrativeEngineBlock(opts?: {
  includePlotEngine?: boolean;
  includeHook3s?: boolean;
  includeInfoIncrement?: boolean;
  includeSceneFields?: boolean;
  includeVisibleAction?: boolean;
  includeShortArc?: boolean;
  includeClipPreflight?: boolean;
  /** 三分钟集：对白/道具/运镜/动作/场景质量块 */
  includeEpisodeQuality?: boolean;
}): string {
  const o = {
    includePlotEngine: true,
    includeHook3s: true,
    includeInfoIncrement: true,
    includeSceneFields: true,
    includeVisibleAction: true,
    includeShortArc: true,
    includeClipPreflight: false,
    includeEpisodeQuality: true,
    ...opts,
  };
  return [
    o.includePlotEngine ? MANHUA_PLOT_ENGINE_BLOCK : "",
    o.includeHook3s ? MANHUA_HOOK_3S_BLOCK : "",
    o.includeInfoIncrement ? MANHUA_INFO_INCREMENT_BLOCK : "",
    o.includeSceneFields ? MANHUA_SCENE_SCRIPT_FIELDS_BLOCK : "",
    o.includeVisibleAction ? MANHUA_VISIBLE_ACTION_BLOCK : "",
    o.includeShortArc ? MANHUA_SHORT_DRAMA_ARC_BLOCK : "",
    o.includeEpisodeQuality ? composeManhuaEpisodeQualityBlock() : "",
    o.includeClipPreflight ? MANHUA_CLIP_PREFLIGHT_BLOCK : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
