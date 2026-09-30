import { formatManhuaShotCoreCatalog } from "../../shared/manhuaShotCoreBank.js";
import { formatManhuaEntranceAtmosphereCatalog } from "../../shared/manhuaEntranceAtmosphereBank.js";
import type { AdvisorPrevisTarget } from "../../shared/manhuaAdvisorPrevisEdit";
import { listManhuaDirectionCards, getManhuaDirectionCard, buildManhuaDirectionCanonFromSelection } from "../../shared/manhuaDirectionCanonLibrary";
import { resolveDirectorStyleBlocks } from "../../shared/manhuaDirectionCanon";
import { listActionCameraRecipes, CONTACT_LEAD_FRAMES, MANHUA_CAMERA_MAX_CUTS } from "../../shared/manhuaCameraDirection";
import { MANHUA_CAMERA_MOVE_BANK } from "../../shared/manhuaCameraMoveBank";
import { listPathCameraRecipes } from "../../shared/manhuaPathCameraRecipeBank";
import { listNarrativeLighting } from "../../shared/manhuaNarrativeLightingBank";
import { listCineVocabByCategory } from "../../shared/manhuaCineVocabBank";
import { MANHUA_PERFORMANCE_CRAFT_ZH } from "../../shared/manhuaPerformanceCraft";

/** 按真实卡库版本与运镜实现提供建议依据，不接受客户端自编导演规则。 */
export function buildAdvisorPrevisCraftBlock(target: Pick<AdvisorPrevisTarget, "directionCardId" | "directionCardVersion">, scope: "previs" | "world" | "general" = "previs"): string {
  const card = target.directionCardId ? getManhuaDirectionCard(target.directionCardId) : null;
  const verified = card && card.version === target.directionCardVersion;
  const blocks = verified ? resolveDirectorStyleBlocks(buildManhuaDirectionCanonFromSelection({ mainCardId: card.id })) : null;
  return [
    "【本次调度建议可用的已实现手法】",
    blocks ? `当前导演包：${blocks.usedCardLabelZh}\n${blocks.storyboard}\n${blocks.clip}` : target.directionCardId ? "当前导演包版本未核对，禁止擅自套用新版；请依据用户的剧情与场景提出建议。" : "当前入口未提供可校验的导演包身份，不能据此认定项目未锁包；保留项目摘要中已有的冻结手法要求。没有已锁定手法时，请自动从下列已批准导演包中选择最适合当前剧情的手法，只形成候选，不替用户改项目选包。\n" + listManhuaDirectionCards().map(c => `${c.labelZh}：${c.rules.filter(r => r.status === "verified" && r.stages.includes("storyboard")).slice(0, 2).map(r => r.ruleZh).join("；")}`).join("\n"),
    `运镜代码的节奏基准：最多${MANHUA_CAMERA_MAX_CUTS}镜，接触镜可在接触前${CONTACT_LEAD_FRAMES}帧切入；按剧情判断，不能每镜机械套用。`,
    ...listActionCameraRecipes().map(r => `${r.nameZh}：适用${r.whenToUseZh}；${r.craftSummaryZh}`),
    "【运镜与摄影目录·候选手法，未选用】",
    ...MANHUA_CAMERA_MOVE_BANK.map(r => `${r.nameZh}：适用${r.whenToUseZh}；${r.promptZh}${r.sequenceZh ? `；先后关系：${r.sequenceZh.join("→")}` : ""}`),
    "【路径目录·按本次秒窗安排，不套用配方固定时长】",
    ...listPathCameraRecipes().map(r => `${r.nameZh}：适用${r.whenToUseZh}；${r.craftSummaryZh}；焦点顺序：${r.phases.map(p => p.focusZh).join("→")}`),
    "【叙事灯光目录·保留场景实际光源动机】",
    ...listNarrativeLighting().filter(r => !r.groupZh).map(r => `${r.nameZh}：适用${r.whenToUseZh}；${r.craftSummaryZh}`),
    `场景光感词库：${listCineVocabByCategory("lighting_feel").map(r => r.zh).join("、")}；仅选符合本场光源与情绪的词，不叠加互相冲突的光感。`,
    formatManhuaEntranceAtmosphereCatalog(scope === "world" ? "world" : "advisor"),
    formatManhuaShotCoreCatalog(scope === "world" ? "world" : "advisor"),
    "【场景氛围优化】逐镜结合地点、时间、天气、空间远近、材质、色调、明暗、背景动静与环境声，写明氛围起点、事件触发和结束状态，说明如何支持人物情绪与场景衔接。薄雾、风雨、烟尘等只有本场已有依据才使用，不凭空换天气、改建筑、添道具或改变已锁音轨；环境声建议沿用原音效合同。",
    scope !== "world" ? MANHUA_PERFORMANCE_CRAFT_ZH : "场景方案用布局、光源与环境层次服务剧情情绪；演员表情、动作和逐秒氛围变化属于正式影片建议，不写成静态3DGS已经执行。",
    scope !== "world" ? "【演员微表情与喜怒哀乐】逐镜点名角色、此刻想要什么、触发事件或台词、情绪起点→可见变化→收住状态；说明说话人与听者各自反应，并与既有秒窗同步。喜可用眼周松开、嘴角轻提；怒可用目光收紧、下颌绷住后释放；哀可用视线下落、短吸气和肩背下沉；乐可用眼神变亮、嘴角展开和身体松开。按性格、强度与景别选少量动作，不把四类全塞进每镜，不擅加哭泣/大笑/台词或改声音演法。动物用耳、眼、口鼻、颈肩、呼吸和重心表达，不套人的咬肌或手指动作。无面部动画的白模只能检验朝向、身体与机位，微表情、眼神光和情绪细节须标为正式影片待补充、尚未预演。" : "",
    "摄影建议须按镜头秒窗写明起点、终点、朝向、景别/视域、移动方向、速度、焦点转移和切点目的；公开秒锁只到小数点后一位，不改底层帧级精度。FOV是视场角，不等于POV/FPV主观视点。横移是摄影机位移，摇镜是原地转向，变焦不能冒充横移；焦段与FOV只有依据当前镜头规格才能给出确定值。灯光/场景建议须写光源、方向、明暗或色温变化的原因及秒窗，保持人物、道具、出入口、轴线和前后场景连续，不机械混用全部目录。",
    scope === "previs"
      ? "【本次输出范围】只改当前白模schema支持的机位和动作。在summaryZh中单列‘正式影片提示词待补充’，写白模不能呈现的景深/拉焦、材质、灯光递进、场景氛围、微表情与情绪表演建议的秒窗，注明未预演。仅讨论且无规格修改时可原样返回完整cameras作为未修改候选，不声称有新修改。不添加未知字段，不声称已实现、已渲染或已采用，不为建议自动重渲染。unsupportedZh只填用户明确要求白模执行且确实不能实现的事项，不把正式影片建议或音轨保留条件列成阻断。"
      : scope === "world"
        ? "【本次输出范围】textPrompt只写静态场景布局、材质、光源与观察方向。运镜建议在summaryZh标为正式影片待补充，不能把相机运动、人物动作或逐秒变光写成3DGS已能执行；不新增schema字段、演员或自动生成。"
        : "【本次输出范围】针对用户问题给出运镜、灯光、场景氛围、演员微表情与情绪表演优化建议，逐镜列秒窗、剧情目的、白模已表达的部分和正式影片提示词需补充的部分；没有规格或实际媒体就明确未知，不把建议当成已应用或审片通过。保留用户已锁对白/BGM/音效及原片，不自行改音轨、段长或提交生产。",
    "必须结合当前问题从上述真实导演包与运镜代码中自动选择适用手法，在建议中说明选用的手法、剧情目的及秒窗；不让用户提供包名或配方名，不把全部手法强加到每个镜头。这些是可选编排依据，不代表白模具备最终视频模型的所有特效。具体人物、动作、视角、FOV与路线仍必须遵守当前白模规格。建议解释为何适合本次剧情，保留用户明确要求；收到新反馈后累计修改，可反复提出方案再试看。",
  ].filter(Boolean).join("\n");
}
