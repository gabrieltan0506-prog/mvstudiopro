import type { AdvisorPrevisTarget } from "../../shared/manhuaAdvisorPrevisEdit";
import { listManhuaDirectionCards, getManhuaDirectionCard, buildManhuaDirectionCanonFromSelection } from "../../shared/manhuaDirectionCanonLibrary";
import { resolveDirectorStyleBlocks } from "../../shared/manhuaDirectionCanon";
import { listActionCameraRecipes, CONTACT_LEAD_FRAMES, MANHUA_CAMERA_MAX_CUTS } from "../../shared/manhuaCameraDirection";

/** 按真实卡库版本与运镜实现提供建议依据，不接受客户端自编导演规则。 */
export function buildAdvisorPrevisCraftBlock(target: Pick<AdvisorPrevisTarget, "directionCardId" | "directionCardVersion">): string {
  const card = target.directionCardId ? getManhuaDirectionCard(target.directionCardId) : null;
  const verified = card && card.version === target.directionCardVersion;
  const blocks = verified ? resolveDirectorStyleBlocks(buildManhuaDirectionCanonFromSelection({ mainCardId: card.id })) : null;
  return [
    "【本次调度建议可用的已实现手法】",
    blocks ? `当前导演包：${blocks.usedCardLabelZh}\n${blocks.storyboard}\n${blocks.clip}` : target.directionCardId ? "当前导演包版本未核对，禁止擅自套用新版；请依据用户的剧情与场景提出建议。" : "项目未锁定导演包，请自动从下列已批准导演包中选择最适合当前剧情的手法，只形成候选，不替用户改项目选包。\n" + listManhuaDirectionCards().map(c => `${c.labelZh}：${c.rules.filter(r => r.status === "verified" && r.stages.includes("storyboard")).slice(0, 2).map(r => r.ruleZh).join("；")}`).join("\n"),
    `运镜代码的节奏基准：最多${MANHUA_CAMERA_MAX_CUTS}镜，接触镜可在接触前${CONTACT_LEAD_FRAMES}帧切入；按剧情判断，不能每镜机械套用。`,
    ...listActionCameraRecipes().map(r => `${r.nameZh}：适用${r.whenToUseZh}；${r.craftSummaryZh}`),
    "必须结合当前问题从上述真实导演包与运镜代码中自动选择适用手法，在建议中说明选用的手法、剧情目的及秒窗；不让用户提供包名或配方名，不把全部手法强加到每个镜头。这些是可选编排依据，不代表白模具备最终视频模型的所有特效。具体人物、动作、视角、FOV与路线仍必须遵守当前白模规格。建议解释为何适合本次剧情，保留用户明确要求；收到新反馈后累计修改，可反复提出方案再试看。",
  ].join("\n");
}
