/**
 * 1110 白模动作参考提示词规则（叶子模块，无任何 import）。
 * compileMvShotTimedPrompt 只在有已采用白模（motionVideos.source="previs"）时写入；没有白模时提示词不变。
 * 单独成文件：canvasMusicMvShotPrompt → 本文件不会经 canvasMusicMvPrevis → canvasMusicMvShotGuards 绕回 prompt 形成循环引用。
 */

/** 头部白模指令。video=@视频N（白模在提交数组中的序号），lookTags=锚图/场景图标记，如「@图片1、@图片2」。 */
export function MV_PREVIS_PROMPT_RULE_ZH(video: string, lookTags: string): string {
  return `白模动作参考：站位、走位、朝向与肢体接触时序严格按${video}（白模动作参考）执行，${video}第 t 秒＝本镜镜内第 t 秒，逐窗按窗标题秒点对齐；白模只提供动作与站位，人物外形、服装与场景以${lookTags}为准，忽略白模的材质与灰模外观（灰色人偶、配色、地面网格），不生成灰模人偶`;
}

/** 逐窗秒点对齐（镜内相对秒）。 */
export function mvPrevisWindowRuleZh(video: string, fromSec: number, toSec: number): string {
  return `站位与动作按${video}镜内 ${fromSec.toFixed(2)}–${toSec.toFixed(2)} 秒段执行`;
}
