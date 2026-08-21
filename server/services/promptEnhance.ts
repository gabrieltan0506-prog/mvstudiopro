/**
 * 防废片编译器·语义增强层(PR B):五要素散文 → 十字段满配提示词。
 * 主力 GLM-5.3 链(百炼→EvoLink→OpenRouter→Qwen 末档,复用 bailianChat 网关兜底);
 * 固定 system prompt(知识库工艺蒸馏)吃百炼缓存价。本层只产文本,计费在路由层
 * (成功才扣,chargeKey 幂等);格式层最后把关目标方言。
 */
import { invokeGlmJsonChatWithGatewayFallback } from "./bailianChat.js";
import {
  COMPILER_ENGINE_LIMITS,
  type CompilerEngineId,
} from "../../shared/manhuaShotIR.js";
import {
  formatPromptForEngine,
  hasBlockingFormatIssues,
  type FormatIssue,
} from "../../shared/promptFormatLayer.js";

/** 增强一次的售价(积分);经济档成本几分钱,定价随拍板调 */
export const PROMPT_ENHANCE_CREDITS = 3;

/** 蒸馏版工艺 system prompt(固定文本=百炼上下文缓存大头) */
const ENHANCE_SYSTEM_ZH = `你是漫剧成片提示词编译器。把用户的简略描述扩写成十字段满配的视频生成提示词,只输出 JSON:{"enhancedPrompt":"..."}。
十字段:时间段/主体动作/摄影机位置/摄影机运动/人物表演/环境运动/灯光变化/声音/连续性约束/禁止内容。
铁令:
1) 空词禁令:禁"电影感/震撼/唯美"等空洞词,写可见的物理事实(焦距/机位/光源/水线方向)。
2) 演技铁令:每句台词配微表情(瞳孔/嘴角/呼吸);禁 motionless/frozen 冻人措辞;人物保留真实毛孔与皮肤质感。
3) 运动降维:一镜一个主运镜;大位移拆"起手+结果";同帧主要动作主体≤2。
4) 一图一句绑定:每个参考各写"继承什么+哪段生效+禁止迁移什么"。
5) 灯光有源,画面零文字零水印;段内不换装不换脸。
保留用户原有的参考标记与对白原文,不得增删台词。输出中文。`;

export type PromptEnhanceResult = {
  enhancedPrompt: string;
  issues: FormatIssue[];
  gateway: string;
};

/** 语义增强(不计费,纯上游调用);reserved 引擎由调用方前置拦截 */
export async function enhancePromptForEngine(params: {
  prompt: string;
  engine: CompilerEngineId;
  abortSignal?: AbortSignal;
}): Promise<PromptEnhanceResult> {
  const profile = COMPILER_ENGINE_LIMITS[params.engine];
  const dialectHint =
    profile.dialect === "seedance"
      ? "目标引擎为 Seedance 系:对白用 {台词} 标记,音效用 <描述>,参考写 @图N/@视频N/@音频N。"
      : "目标引擎为 Minimax H3:全自然语言,禁止 {}<>【】() 标记,参考写 Image N/Video N/Audio N。";

  const res = await invokeGlmJsonChatWithGatewayFallback({
    system: ENHANCE_SYSTEM_ZH,
    user: `${dialectHint}\n单段时长上限 ${profile.maxSegmentSec}s。\n用户提示词:\n${params.prompt}`,
    maxTokens: 16_384,
    abortSignal: params.abortSignal,
    validateContent: (text) => {
      const parsed = JSON.parse(text) as { enhancedPrompt?: unknown };
      if (typeof parsed.enhancedPrompt !== "string" || !parsed.enhancedPrompt.trim()) {
        throw new Error("增强结果缺少 enhancedPrompt");
      }
    },
  });

  const content = String(res.choices?.[0]?.message?.content || "");
  const enhanced = (JSON.parse(content) as { enhancedPrompt: string }).enhancedPrompt;
  // 出口过格式层:语义层产出也要过同一把尺(避审/方言/钳制)
  const formatted = formatPromptForEngine(enhanced, params.engine);
  // 阻止级问题=增强失败:抛错让路由层不扣费,censor 仅记录放行
  if (hasBlockingFormatIssues(formatted.issues)) {
    throw new Error(
      `增强结果未过格式关:${formatted.issues.map((i) => i.detailZh).join(";")}`,
    );
  }
  return { enhancedPrompt: formatted.text, issues: formatted.issues, gateway: res.gateway };
}
