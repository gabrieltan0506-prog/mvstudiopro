/**
 * 「生成关键静帧」的**唯一入口**裁决（纯函数）。
 *
 * 线上问题（对照图 04 + README 点名）：同一屏最多能看到三个「生成关键静帧」按钮
 * —— 工具条一个、阶段底栏主操作一个、分镜面板里还有一个，全都调同一个
 * `runGenerateAllKeyarts`。这个动作会**重跑整条管线、重写段表并按张扣费**（0917 实锤事故），
 * 三个同名按钮等于三个误点机会。
 *
 * 这里只决定「这一屏由谁承担这个入口」，**不改 handler、不改扣费逻辑**：
 * 阶段主操作优先 → 其次分镜面板（那儿是真的没图、就地补图） → 最后工具条兜底。
 * 收敛后仍然保证**至少有一个**入口，不会把功能藏死。
 */
export type ManhuaKeyartEntry = "stage" | "panel" | "toolbar";

export function pickManhuaKeyartEntry(input: {
  /** 阶段底栏主操作此刻就是「生成关键静帧」 */
  stageCtaIsKeyart: boolean;
  /** 当前在分镜阶段，且分镜面板正提示本段没有静帧 */
  panelNeedsKeyart: boolean;
}): ManhuaKeyartEntry {
  if (input.stageCtaIsKeyart) return "stage";
  if (input.panelNeedsKeyart) return "panel";
  return "toolbar";
}

/** 某个渲染位置此刻该不该画这个按钮 */
export function manhuaKeyartEntryVisible(
  at: ManhuaKeyartEntry,
  input: { stageCtaIsKeyart: boolean; panelNeedsKeyart: boolean },
): boolean {
  return pickManhuaKeyartEntry(input) === at;
}
