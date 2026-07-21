/**
 * 漫剧叙事引擎：目标·阻力·代价 / 前三秒钩子 / 信息增量 / 场次可拍模板。
 * 学公开短视频剧本框架结构，成稿自写；前台不露外站名。
 */

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
每场尽量写清：场次｜时长｜场景（时·内外·地点）｜人物｜画面（可见动作）｜对白｜镜头（景别+运镜序列）｜声音｜转场｜生成备注（服装发型灯光连续）。
六项自检：冲突是否开场成立｜目标阻力代价是否清楚｜每拍是否有变化｜对白是否推动关系｜情绪是否变成可见动作｜结尾是否留钩子。`;

/** 少心理多动作 */
export const MANHUA_VISIBLE_ACTION_BLOCK = `【可拍改写】
少写抽象心理，多写动作、表情、道具、站位、声音与镜头变化。
例：勿写「她很害怕」→ 写「后退半步，手指死死抓住门把，视线越过对方肩膀寻找走廊出口」。
对白要一句一拳；道具须承担信息（合同/车票/聊天记录等），勿纯装饰。`;

/** 短剧默认节奏（AI 漫剧/动态漫） */
export const MANHUA_SHORT_DRAMA_ARC_BLOCK = `【短剧默认弧】
0–3 秒：压力/冲突/反差；中段：主角被逼到抉择点；后段：证据/身份/道具/新信息反转；结尾：爽点或悬念或细节回扣。
默认 2–3 场；3–5 句对白内须有冲突或信息变化；结尾触发追更欲。`;

/** 成片侧（图生视频）降废片约束——学竞品工作流结构，不写外站名 */
export const MANHUA_CLIP_PREFLIGHT_BLOCK = `【成片预演硬锁】
1. 形象连续：本镜人物发型服装与已锁定静帧一致，禁止换脸换装。
2. 先静帧后成片：无静帧勿空想整集视频。
3. 运镜一次一事：单镜主运镜 1 种，勿堆叠甩镜+升降+手持。
4. 时长对齐本镜秒数；禁止本镜按整集 10 秒灌水。
5. 台词只驱动口型气口，画面无字幕。`;

export function composeManhuaNarrativeEngineBlock(opts?: {
  includePlotEngine?: boolean;
  includeHook3s?: boolean;
  includeInfoIncrement?: boolean;
  includeSceneFields?: boolean;
  includeVisibleAction?: boolean;
  includeShortArc?: boolean;
  includeClipPreflight?: boolean;
}): string {
  const o = {
    includePlotEngine: true,
    includeHook3s: true,
    includeInfoIncrement: true,
    includeSceneFields: true,
    includeVisibleAction: true,
    includeShortArc: true,
    includeClipPreflight: false,
    ...opts,
  };
  return [
    o.includePlotEngine ? MANHUA_PLOT_ENGINE_BLOCK : "",
    o.includeHook3s ? MANHUA_HOOK_3S_BLOCK : "",
    o.includeInfoIncrement ? MANHUA_INFO_INCREMENT_BLOCK : "",
    o.includeSceneFields ? MANHUA_SCENE_SCRIPT_FIELDS_BLOCK : "",
    o.includeVisibleAction ? MANHUA_VISIBLE_ACTION_BLOCK : "",
    o.includeShortArc ? MANHUA_SHORT_DRAMA_ARC_BLOCK : "",
    o.includeClipPreflight ? MANHUA_CLIP_PREFLIGHT_BLOCK : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
