/** 顾问参数目录与只读核对。能力来自生产合同；不调用模型、不改稿、不建单。 */
import { resolveManhuaCreativeAdvisorEngineFacts, type ManhuaCreativeAdvisorContext } from "./manhuaCreativeAdvisor.js";
import { canvasVideoResolutionsForModel, resolveCanvasVideoResolution } from "./canvasGenerationPricing.js";
import { HAILUO_OPENROUTER_DURATION_CHOICES, HAILUO_OPENROUTER_ASPECT_RATIOS, normalizeHailuoOpenRouterResolution } from "./hailuoOpenRouterModels.js";
import { WAN30_ASPECT_RATIOS, WAN30_REFERENCE_AUDIO_TOTAL_SEC_MAX } from "./wanWavespeedModels.js";
import { tryCompileManhuaVideoPromptForOutbound } from "./manhuaOutboundPrompt.js";
import { parseManhuaClipTargetDurationSec } from "./manhuaScriptWorkbench.js";

export const ADVISOR_REVIEW_MODEL_IDS = ["seedance-2.0-mini", "seedance-2.0", "seedance-2.0-fast", "seedance-2.5", "minimax-hailuo-3", "wan-3.0"] as const;

/** 文本中的明确冲突候选；不是画面结论，也不产生生成门禁。 */
export function findAdvisorPromptContradictions(prompt: string) {
  const findings: Array<{ id: string; window: string; evidence: string[]; suggestion: string }> = [];
  const lines = prompt.split(/\r?\n/);
  for (const line of lines) {
    const window = line.match(/^\s*([\d.]+\s*[–—-]\s*[\d.]+s)[:：]/)?.[1];
    if (!window) continue;
    const airborne = line.match(/(?:受伤的)?左前腿[^，。；\n]{0,12}悬空/);
    const grounded = line.match(/(?:左前腿|蜷腿)(?:明显)?落(?:在湿石板|地)/);
    if (airborne && grounded) findings.push({
      id: "limb-state", window, evidence: [grounded[0], airborne[0]],
      suggestion: `可将“${grounded[0]}”改为“右前蹄踩住湿石板，左前腿继续蜷起悬空”，其余剧情与对白保留；请先确认“蜷腿”确指同一左前腿。`,
    });
    // 仅覆盖已明确命名的棕马墨屠与后文未命名的黑马/眼罩，避免将不同马匹或明确变身混为冲突。
    if (/黑马\s*\/\s*眼罩/.test(line) && /棕马墨屠/.test(prompt) && !/变(?:成|为)|褪(?:成|为)|另(?:一|只|匹)/.test(line)) findings.push({
      id: "horse-color", window, evidence: ["棕马墨屠", "黑马/眼罩"],
      suggestion: "若此处仍是墨屠且没有变色，可将“黑马/眼罩”改为“棕马墨屠/眼罩”；只调整矛盾用词，不据此判断参考图错误。",
    });
  }
  return findings;
}

/** 最终答复携带程序核对范围，防止模型漏报已定位候选或把存稿当作最终素材。 */
export function composeAdvisorPromptReviewAnswer(answer: string, context: ManhuaCreativeAdvisorContext): string {
  const review = context.videoPromptReview;
  if (!review || context.studio3d || context.previsEdit || context.worldTarget) return answer;
  const findings = findAdvisorPromptContradictions(review.prompt);
  return [
    `**本次核对范围：第${review.segmentIndex}段保存文本与节点设置。** 工厂自动生成并适配提示词，无需从零手填。最终图片/视频/音频数组、引用数量与顺序、文件和画面尚未核验；存稿编号不能证明数量合规或没有音视频参考。系统现有门禁仍有效，是否需要更新静帧须核具体版本和画面证据，下面都是可选建议，不自动改稿或生成。`,
    ...(findings.length ? ["**程序定位的文本矛盾候选（供选择）**", ...findings.map(f => `- ${f.window}：“${f.evidence.join("”与“")}”。${f.suggestion}`)] : ["程序规则未定位明确候选，不代表全文没有矛盾，仍需顾问与人工核对。"]),
    "**顾问分析（参考意见，以上核对范围与候选不因模型遗漏而取消）**", answer,
  ].join("\n\n");
}

/** 完整登记已接通产品能力与调用职责，不能把不同供应商的字段混作同一个请求。 */
export function advisorModelContract(model: string) {
  const facts = resolveManhuaCreativeAdvisorEngineFacts(model);
  if (!facts.recognized) return facts;
  const h3 = facts.dialect === "h3";
  const wan = facts.dialect === "wan";
  return {
    ...facts,
    productResolutions: canvasVideoResolutionsForModel(facts.engineId),
    parameterFields: {
      model: "由用户选用模型与已接通通道/模式决定，不自动换模型",
      prompt: "工厂系统稿或用户保存全文，提交时自动适配方言",
      duration: h3 ? "产品5/10/15秒，参考通道4–15整数秒" : wan ? "产品2–30整数秒；上游智能-1不是当前产品默认" : facts.engineId === "seedance-2.5" ? "4–30秒；编辑与源片等长，延长时长须另核，-1不是产品默认" : "4–15秒",
      resolution: "产品分辨率在计费前归一；网关映射quality，官方通道映射resolution",
      aspectRatio: "产品9:16/16:9；参考模式与首尾帧模式分别核对，不猜画幅",
      imageReferences: "按实际出站数组顺序，不用存稿快照冒充素材",
      videoReferences: "按实际出站数组顺序，另核长度、格式、容量与输入视频计费",
      audioReferences: "按实际数组绑定唯一声音职责，不能静默丢弃；不保证实际口型或音色已验",
      generateAudio: h3 ? "声音由当前通道合同决定，不虚构voice_id或seed字段" : "默认保留；不因顾问改稿擅自关闭",
      optionalParameters: h3 ? "当前参考适配器不发送seed、content或image_start/image_end" : wan ? "seed可选0–2147483647整数；参考适配器不发送image_start/image_end" : "网关content_filter与output_format由服务端控制；2.5文生可传model_params.web_search；参考/图生/编辑/延长各自校验，未经授权不改变设置",
    },
    productAspectRatios: h3 ? HAILUO_OPENROUTER_ASPECT_RATIOS : wan ? WAN30_ASPECT_RATIOS : ["9:16", "16:9"],
    productDurationChoices: h3 ? HAILUO_OPENROUTER_DURATION_CHOICES : null,
    providerPromptMaxChars: h3 ? 7000 : wan ? 20000 : null,
    referenceInputZh: h3
      ? "参考图≤30MB、256–5760px、比例0.4–2.5；视频MP4/MOV H.264/H.265≤50MB、单条2–15秒且合计≤15秒；音频WAV/MP3≤15MB、单条2–15秒且合计≤15秒。参考模式不能混首尾帧。"
      : wan
        ? "视频≤5、合计≤15秒；音频≤5、合计≤15秒；参考视频输入时长+输出时长≤30秒。参考模式不收image_start/image_end。实际参考可用性与时长须另核。"
        : "图片/视频/音频独立数组，从1编号，与实际发送顺序一一对应；图片锁身份/服装/场景，视频锁动作/镜头，音频锁角色声音；具体模式和实际槽位以出站确认结果为准，不拿存稿编号代替。",
    submissionZh: "创建仅一次，保存任务ID后查同一ID；回执未知不重交，不因顾问建议自动生成或重试。积分与退款按正式确认和任务回执核对，不能猜费用或保证画面质量。",
    callContractZh: h3
      ? "画布时长5/10/15秒；参考生成上游接受4–15整数秒。草稿720p映射quality=768p，高清2K映射quality=2k。参考分image_urls/video_urls/audio_urls，按Image N/Video N/Audio N引用；至少1项、合计≤12，不混用直连content或首尾帧字段；参考文件可用性由出站确认另核。"
      : wan
        ? `画布画质按产品选项；参考生成质量字段quality，独立image_urls/video_urls/audio_urls，generate_audio保留声音，seed可选0–2147483647整数。音频合计≤${WAN30_REFERENCE_AUDIO_TOTAL_SEC_MAX}秒；通道有各自字段映射，不能混用百炼content与网关独立数组，也不能静默丢音视频。`
        : "文生、图生与多模态参考按实际素材选模式；2.5另支持编辑和延长。网关字段为model/prompt/duration/quality/aspect_ratio/generate_audio与参考数组；图生、编辑、延长使用adaptive画幅。官方content通道由服务端转换，不把网关数组混进去。generate_audio不得因提示词检查擅自关闭；价格以提交前实际确认值为准。",
    automaticPromptZh: h3 || wan
      ? "系统稿自动把Seedance引用和对白标记转为本模型自然语言；不要求用户从零手写或手工换标记。"
      : "系统稿中的中文对白「…」自动编译为{…}，段落标题【…】自动转为非字幕标题，@图N自动输出@图片N；用户无需手改，也不能仅据存稿格式判断阻断。",
  };
}

export function buildAdvisorModelReviewFacts(context: ManhuaCreativeAdvisorContext): string {
  const catalogue = ADVISOR_REVIEW_MODEL_IDS.map(advisorModelContract);
  const review = context.videoPromptReview;
  if (!review) return "【已接通模型参数目录·程序合同】\n" + JSON.stringify(catalogue) + "\n未提供保存节点设置，不能假称已核实际参数；提示词由工厂生成，用户修改是可选的。";
  const model = advisorModelContract(context.videoModel);
  const durationSec = parseManhuaClipTargetDurationSec(review.prompt);
  const compiled = tryCompileManhuaVideoPromptForOutbound({ prompt: review.prompt, engine: context.videoModel, durationSec: durationSec ?? undefined });
  const settings = model.recognized ? {
    selectedVideoModel: context.videoModel,
    savedNodeVideoModel: review.videoModel,
    savedResolution: review.resolution ?? "未保存，采用产品默认",
    effectiveProductResolution: resolveCanvasVideoResolution(model.engineId, review.resolution),
    ...(model.dialect === "h3" ? { effectiveQuality: normalizeHailuoOpenRouterResolution(resolveCanvasVideoResolution(model.engineId, review.resolution)) } : {}),
    aspectRatio: review.aspectRatio,
    durationSec: durationSec ?? "存稿未标明",
  } : { selectedVideoModel: context.videoModel, savedNodeVideoModel: review.videoModel };
  const parameterFindings: string[] = [];
  if (model.recognized) {
    if (durationSec != null && model.productDurationChoices && !(model.productDurationChoices as readonly number[]).includes(durationSec)) parameterFindings.push(`保存时长${durationSec}秒不是本产品可选时长${model.productDurationChoices.join("/")}；实际提交档须核对，顾问不得自行截对白或改剧情。`);
    if (review.resolution && !model.productResolutions.includes(review.resolution)) parameterFindings.push(`节点保存画质${review.resolution}不在本模型产品档位内，实际规范档为${resolveCanvasVideoResolution(model.engineId, review.resolution)}；这是设置差异，不代表需要重出图片。`);
    if (model.providerPromptMaxChars && compiled.text.length > model.providerPromptMaxChars) parameterFindings.push("文本超出已登记通道字符上限；不能静默截断正文，需先核对实际出站全文。");
  }
  return [
    "【已接通模型参数目录·程序合同】", JSON.stringify(catalogue),
    "【本次保存节点参数·只读核对】", JSON.stringify({ blockId: review.blockId, segmentIndex: review.segmentIndex, ...settings }),
    "【共享生产编译器只读核对·未提交】",
    JSON.stringify({ issues: compiled.issues, blocked: compiled.blocked, fatalZh: compiled.fatalZh, parameterFindings, text: compiled.text }),
    "【程序定位的文本矛盾候选·需逐项回应，不是生成阻断】", JSON.stringify(findAdvisorPromptContradictions(review.prompt)),
    "【素材证据范围】", JSON.stringify({ finalReferenceArrays: "未提供", referenceCounts: "未验证", referenceAbsence: "不能确认没有视频或音频参考", visualContent: "未读取画面" }),
    "上述只核保存文本与可确定设置。最终媒体数组、编号职责、参考时长、文件规格和上游路由尚未解析，不代表最终出站预览或能生成；不猜实际参考数量。存稿硬绑是快照，提交会重算，不能据此要求补图。",
    "顾问建议不改变系统门禁；把真实限制与可选修正分开。正文矛盾先给可采纳的最小修正稿，不能要求用户重新手填整段；不能因只改文字强迫重出图片。",
  ].join("\n");
}
