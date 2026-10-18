import { digitalHumanProjectSegments } from "./digitalHumanProject";
import { digitalHumanDraftSchema, type DigitalHumanDraft } from "./digitalHumanStudio";

type Model = NonNullable<DigitalHumanDraft["mainModel"]>;
/** 历史记录属于项目资产，不应因切换段落而丢失采用入口。 */
export function digitalHumanReusableModels(draft: DigitalHumanDraft) {
  const found = new Map<string, { model: Model; label: string }>();
  for (const segment of digitalHumanProjectSegments(draft)) {
    const d = segment.draft;
    for (const model of [...d.modelHistory.map(h => h.model), ...(d.mainModel ? [d.mainModel] : [])]) {
      if (model.status !== "succeeded" || !(model.glbGcsUri || model.glbUrl)) continue;
      const name = d.portrait?.source === model.sourceVersion ? d.portrait.name : undefined;
      found.set(model.taskId, { model, label: `${name || "历史人物造型"} · ${model.taskId}` });
    }
  }
  return Array.from(found.values());
}

export function adoptDigitalHumanModel(draft: DigitalHumanDraft, expected: Model, resolved: Model): DigitalHumanDraft {
  if (resolved.taskId !== expected.taskId || resolved.sourceVersion !== expected.sourceVersion)
    throw new Error("原模型身份与来源不一致，未采用");
  if (resolved.status !== "succeeded" || !(resolved.glbGcsUri || resolved.glbUrl))
    throw new Error("原模型尚无可用三维产物，未采用");
  if (!resolved.sourceVersion.startsWith("gs://"))
    throw new Error("原模型缺少持久人物图片地址，未采用");
  if (!resolved.assetRef || (expected.assetRef && expected.assetRef !== resolved.assetRef))
    throw new Error("原模型资产编号缺失或不匹配，未采用");
  const history = [...draft.modelHistory];
  for (const model of [draft.mainModel, resolved]) {
    if (model && !history.some(h => h.model.taskId === model.taskId))
      history.push({ assetRef: model.assetRef || `dh-person-${draft.id}`, model });
  }
  return digitalHumanDraftSchema.parse({
    ...draft,
    portrait: { source: resolved.sourceVersion, name: `已有造型 · ${resolved.taskId}` },
    mainModel: resolved,
    modelHistory: history,
    ...(draft.portrait?.source !== resolved.sourceVersion ? { previsSpatialInvalidated: true } : {}),
  });
}
