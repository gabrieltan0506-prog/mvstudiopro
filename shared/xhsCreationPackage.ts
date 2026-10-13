import { z } from "zod";
import { platformGraphicNotePageSchema } from "./platformTopicShortlist.js";
import { platformStoryboardCellSchema } from "./platformStoryboardCells.js";
import { VIRAL_CREATION_METHODS, VIRAL_CONTENT_STRUCTURES } from "./viralCreationMethods.js";
import { reviewXhsDraft, type XhsGrowthEvidence } from "./xhsContentStrategy.js";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** 正文/封面都来自同一份创作包；不另造未接线的展示对象。 */
export const xhsCreationPackageSchema = z.object({
  structure: z.object({ templateId: text(1, 40), steps: z.array(z.object({ name: text(2, 80), quote: text(8, 800) })).min(4).max(5) }),
  audience: text(2, 160), scene: text(2, 160), problem: text(2, 160),
  titleOptions: z.array(z.object({ title: text(4, 120), angle: text(4, 180) })).length(4),
  cover: z.object({
    headline: text(2, 13), subline: z.string().trim().max(18),
    visual: text(20, 1600), layout: text(10, 600), continuity: text(10, 600),
  }),
  conversion: z.object({
    goal: z.enum(["acquire", "follow", "convert"]),
    action: text(4, 240), offer: text(2, 300), delivery: text(2, 300),
  }),
  promiseDelivery: z.array(z.object({
    promise: text(4, 160), section: z.enum(["copywriting", "detailedScript", "graphicNotePages"]),
    quote: text(8, 800),
  })).min(1).max(6),
  evidenceRefs: z.array(text(1, 2000)).max(12),
  experiment: z.object({
    hypothesis: text(8, 300), variable: z.enum(["封面", "标题", "开头"]),
    primaryMetric: text(2, 100), observation: text(8, 400),
  }),
});
export type XhsCreationPackage = z.infer<typeof xhsCreationPackageSchema>;

export const XHS_PACKAGE_OUTPUT_PROMPT = `额外输出xhsPackage，且必须与同一blueprint正文一致：
{
 "structure":{"templateId":"从methodPlan.structureLibrary选择一个id","steps":[{"name":"所选结构steps中的步骤名，全部依次列出","quote":"至少8字，逐字引用正文或分页/分镜中的对应内容"}]},
 "audience":"具体人群", "scene":"生活场景", "problem":"一个问题",
 "titleOptions":[{"title":"与blueprint.title完全一致的主选","angle":"为什么适合"}, {"title":"备选一","angle":"不同切口"}, {"title":"备选二","angle":"不同切口"}, {"title":"备选三","angle":"不同切口"}],
 "cover":{"headline":"2–13字主标","subline":"0–18字副标","visual":"至少20字，人物/物件、场景、可見动作和光线","layout":"至少10字，构图/文字位置/留白","continuity":"至少10字，后续图沿用的角色/道具/色彩"},
 "conversion":{"goal":"acquire或follow或convert","action":"唯一主动作，真实自然","offer":"真实商品服务，没提供则明确未设商品","delivery":"交付内容与边界，没有商品则写关注后的下一期价值"},
 "promiseDelivery":[{"promise":"标题或开头承诺","section":"copywriting或detailedScript或graphicNotePages","quote":"逐字引用该字段中实际兑现承诺的至少8字内容，不另写一段"}],
 "evidenceRefs":["只能用pick.xhsGrowthEvidence.samples实际id，用户素材写creator；未用则空数组"],
 "experiment":{"hypothesis":"待验证假设，不能保证结果","variable":"封面或标题或开头，仅选一个","primaryMetric":"匹配目标的一个指标","observation":"同口径24小时和7天分别观察，说明要收集的分母及缺失时不计算"}
}
titleOptions恰好4个不同标题，首个为主选。xhsPackage是创作方案，不得把其字段名、运营说明或检查内容画进给读者看的封面/图文。`;

export type XhsPackageAudit = { passed: boolean; findings: Array<{ code: string; message: string }>; package?: XhsCreationPackage };
const flat = (value: unknown): string => typeof value === "string" ? value.replace(/\s+/g, "") : Array.isArray(value) ? value.map(flat).join("") : value && typeof value === "object" ? Object.values(value).map(flat).join("") : "";

/** 可自动验证的契约：来源ID、非空视觉、主标题一致、承诺对应原文。语义真实性仍需审稿。 */
export function auditXhsCreationPackage(blueprint: Record<string, unknown>, evidence?: XhsGrowthEvidence, expectedFormat?: "图文" | "短视频"): XhsPackageAudit {
  const result = xhsCreationPackageSchema.safeParse(blueprint.xhsPackage);
  if (!result.success) return { passed: false, findings: result.error.issues.map(issue => ({ code: "package_schema", message: `${issue.path.join(".")}：${issue.message}` })) };
  const p = result.data;
  const findings: XhsPackageAudit["findings"] = [];
  if (expectedFormat && blueprint.format !== expectedFormat) findings.push({ code: "format_mismatch", message: "正文形式与本次选择不一致" });
  for (const field of ["copywriting", "detailedScript"] as const) {
    if (typeof blueprint[field] !== "string" || !String(blueprint[field]).trim()) findings.push({ code: "empty_content", message: `${field}不能为空` });
  }
  if (blueprint.format === "图文") {
    const pages = z.array(platformGraphicNotePageSchema).min(1).max(12).safeParse(blueprint.graphicNotePages);
    if (!pages.success || pages.data.some((page, i) => page.pageIndex !== i + 1)) findings.push({ code: "graphic_pages", message: "图文须有完整且连续编号的1–12页，不能丢页或截断" });
  } else if (blueprint.format === "短视频") {
    const cells = z.array(platformStoryboardCellSchema).min(1).max(12).safeParse(blueprint.storyboardCells);
    if (!cells.success || cells.data.some((cell, i) => cell.cellIndex !== i + 1 || !cell.sceneZh.trim() || !cell.actionZh.trim() || !cell.shotSize.trim() || !cell.cameraMoveZh.trim())) findings.push({ code: "storyboard_cells", message: "视频须有完整连续的1–12镜，场景、动作、景别与运镜不可为空" });
  } else findings.push({ code: "content_format", message: "请选择图文或短视频" });
  const methods = z.array(z.object({ methodId: text(1, 80), quote: text(8, 800), application: text(8, 500) })).min(1).max(7).safeParse(blueprint.methodApplications);
  const structure = VIRAL_CONTENT_STRUCTURES.find(row => row.id === p.structure.templateId);
  if (!structure || p.structure.steps.length !== structure.steps.length || p.structure.steps.some((step, i) => step.name !== structure.steps[i])) findings.push({ code: "structure_steps", message: "内容结构步骤不完整或顺序不符" });
  const methodIds = new Set<string>(VIRAL_CREATION_METHODS.map(method => method.id));
  const output = flat([blueprint.title, blueprint.hook, blueprint.copywriting, blueprint.detailedScript, blueprint.graphicNotePages, blueprint.storyboardCells]);
  if (p.structure.steps.some(step => !output.includes(flat(step.quote))) || new Set(p.structure.steps.map(step => flat(step.quote))).size !== p.structure.steps.length) findings.push({ code: "structure_quote", message: "每个结构步骤须有不同且真实存在的正文落点" });
  if (!methods.success || methods.data.some(method => !methodIds.has(method.methodId) || !output.includes(flat(method.quote)))) findings.push({ code: "method_application", message: "须注明实际方法ID、应用说明及正文中存在的原文片段" });

  if (p.titleOptions[0].title !== String(blueprint.title || "").trim()) findings.push({ code: "title_mismatch", message: "主选标题与正文标题不一致" });
  if (new Set(p.titleOptions.map(t => flat(t.title))).size !== 4) findings.push({ code: "repeated_titles", message: "标题备选需要四个不同切口" });
  for (const promise of p.promiseDelivery) {
    if (!flat(blueprint[promise.section]).includes(flat(promise.quote))) findings.push({ code: "promise_quote_missing", message: `承诺“${promise.promise}”的引用不在${promise.section}原文中` });
  }
  const refs = new Set(["creator", ...(evidence?.samples.map(s => s.id) || [])]);
  for (const ref of p.evidenceRefs) if (!refs.has(ref)) findings.push({ code: "unknown_evidence", message: `引用不在本次样本中：${ref}` });
  // 检查读者会看到的内容；不把审核说明自身的反面词例误判为宣传。
  const publicText = [blueprint.title, blueprint.hook, blueprint.copywriting, blueprint.detailedScript, flat(blueprint.graphicNotePages), flat(blueprint.storyboardCells), ...p.titleOptions.map(t => t.title), p.cover.headline, p.cover.subline, p.conversion.action].join("\n");
  findings.push(...reviewXhsDraft(publicText));
  return { passed: findings.length === 0, findings, package: p };
}

/** 将已校验方案写入既有消费者字段，封面/分镜/DB快照均复用原链路。 */
export function connectXhsPackageToBlueprint(blueprint: Record<string, unknown>, p: XhsCreationPackage): void {
  const ex = blueprint.executionDetails && typeof blueprint.executionDetails === "object" ? blueprint.executionDetails as Record<string, unknown> : {};
  blueprint.executionDetails = {
    ...ex,
    environmentAndWardrobe: [ex.environmentAndWardrobe, `【封面场景】${p.cover.visual}`, `【系列连续性】${p.cover.continuity}`].filter(Boolean).join("\n"),
    lightingAndCamera: [ex.lightingAndCamera, `【封面构图】${p.cover.layout}`].filter(Boolean).join("\n"),
  };
  const platform = blueprint.targetPlatform === "douyin" ? "douyin" : "xiaohongshu";
  const variants = Array.isArray(blueprint.platformVariants) ? blueprint.platformVariants as Array<Record<string, unknown>> : [];
  const previous = variants.find(v => v.platform === platform) || {};
  blueprint.platformVariants = [{ ...previous, platform, format: blueprint.format, hook: blueprint.hook,
    coverHeadline: p.cover.headline, coverSubline: p.cover.subline }];
  blueprint.xhsPackage = p;
}
