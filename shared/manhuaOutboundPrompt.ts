/** 预览、生产出站和顾问共用的只读编译；不发请求、不改变存稿。 */
import { COMPILER_ENGINE_LIMITS, normalizeCompilerEngineId, type CompilerEngineId } from "./manhuaShotIR.js";
import { renderManhuaClipPromptForSeedance } from "./manhuaClipPromptSanitize.js";
import { formatPromptForEngine, hasBlockingFormatIssues, type FormatIssue } from "./promptFormatLayer.js";

export type ManhuaOutboundPromptCompileInput = {
  prompt: string;
  engine: CompilerEngineId | string;
  durationSec?: number;
  imageRefCount?: number;
  videoRefCount?: number;
  audioRefCount?: number;
};

export type ManhuaOutboundPromptCompileResult = {
  /** 真正会发出去的提示词全文；blocked 时仍给出，便于确认界面指出问题所在 */
  text: string;
  issues: FormatIssue[];
  /** true = 出站校验不通过，生产路径会抛错、不建单不扣费 */
  blocked: boolean;
  /** 引擎缺编译规则这类连编译都进不去的情况 */
  fatalZh?: string;
  engine?: CompilerEngineId;
};

/**
 * 出站提示词编译（**不抛错**版本）。
 *
 * 生成前确认界面要展示的必须是这一份——节点上存的 prompt 与真正发出去的不是同一个串：
 * Seedance 会先过 renderManhuaClipPromptForSeedance，再按引擎/时长/参考数量重排格式，
 * 出口还要把 @图N 还原成 @图片N。预览与下单共用本函数，避免两套逻辑各自漂移。
 */
export function tryCompileManhuaVideoPromptForOutbound(
  input: ManhuaOutboundPromptCompileInput,
): ManhuaOutboundPromptCompileResult {
  const engine = normalizeCompilerEngineId(input.engine);
  if (!engine) {
    return {
      text: String(input.prompt || ""),
      issues: [],
      blocked: true,
      fatalZh: "当前成片引擎缺少提示词编译规则",
    };
  }
  // 按**方言**判定，不按 id 前缀：HappyHorse 登记为 seedance 方言
  // （生产一直送 Seedance 渲染器的产物），id 却不以 seedance- 开头。
  const usesSeedanceDialect = COMPILER_ENGINE_LIMITS[engine].dialect === "seedance";
  const seedanceSource = usesSeedanceDialect
    ? renderManhuaClipPromptForSeedance(input.prompt)
    : input.prompt;
  const formatted = formatPromptForEngine(seedanceSource, engine, {
    durationSec: input.durationSec,
    imageRefCount: input.imageRefCount,
    videoRefCount: input.videoRefCount,
    audioRefCount: input.audioRefCount,
    applyCensorReplacements: false,
  });
  // 生产绑定层按官方素材类型标记生成 @图片N；格式层内部统一成 @图N 后在出口还原。
  const text = usesSeedanceDialect
    ? formatted.text.replace(/@图(\d+)/g, "@图片$1")
    : formatted.text;
  return {
    text,
    issues: formatted.issues,
    blocked: hasBlockingFormatIssues(formatted.issues),
    engine,
  };
}

