import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { digitalHumanAdoptedFilmPrompt, type DigitalHumanDraft } from "@shared/digitalHumanStudio";
import type { buildManhuaAdvisorProject } from "./manhuaAdvisorProject";

/** 来源没有锁秒时保留逐镜原文，让顾问在实际预演时长内安排；不伪造已确认时间轴。 */
export function digitalHumanShotText(draft: DigitalHumanDraft): string {
  let film = "";
  if (draft.filmDirector?.adopted) {
    try {
      digitalHumanAdoptedFilmPrompt(draft);
      film = draft.filmDirector.plan.shots.map((s,i)=>`镜${i+1} ${s.startSec}–${s.endSec}秒（细节从本镜0秒计）：动作：${s.action}；运镜：${s.camera}`).join("\n");
    } catch { /* 过期方案不注入空间顾问。 */ }
  }
  return [
    film && `当前已采用导演方案的动作与运镜（含手动微调，空间编排须遵循）：\n${film}`,
    draft.direction.trim() && `当前表演与镜头要求（与来源冲突时优先）：\n${draft.direction.trim()}`,
    draft.source?.shots.length && draft.source.shots.map(s => `镜${s.cellIndex}：${s.sceneZh}；${s.shotSize}；动作：${s.actionZh}；运镜：${s.cameraMoveZh}；对白：${s.dialogueZh}；剪辑与声音：${s.editNoteZh}`).join("\n"),
  ].filter(Boolean).join("\n\n");
}
export function buildDigitalHumanAdvisorProject(draft: DigitalHumanDraft): ReturnType<typeof buildManhuaAdvisorProject> {
  const clipId = `dh-previs-${draft.id}`;
  const actors = [
    ...(draft.portrait ? [{ id: `dh-person-${draft.id}`, label: "讲述者", point: draft.mainStage, model: draft.mainModel }] : []),
    ...draft.actors.map(a => ({ id: a.id, label: a.labelZh, point: { x: a.x, y: a.y, yaw: a.yaw }, model: a.model })),
  ];
  const issues = !draft.script.trim() ? [{ id: "script", text: "请先采用或填写完整口播正文。", phase: "outline" as const, blocking: true }] : [];
  const context = manhuaCreativeAdvisorContextSchema.parse({
    seriesTitle: draft.source?.title || "数字人口播",
    episodeIndex: 1, episodeTitle: "当前口播", stage: "storyboard",
    activeStudio: { tool: "previs", episodeIndex: 1, clipId },
    videoModel: draft.filmModel || "seedance-2.5", writerConfirmed: Boolean(draft.script.trim()),
    episodeBody: draft.script,
    assetSummary: actors.map(a => `${a.label}（${a.id}）：位置 ${JSON.stringify(a.point || { x: 0, y: 0, yaw: 0 })}；3D模型${a.model?.status || "未建立"}`).join("\n") + `\n场景：${draft.sceneDescription}；3DGS${draft.worldTaskId ? "已选择" : "未选择"}`,
    shotSummary: digitalHumanShotText(draft),
    previsSummary: draft.previsStudio ? `当前真实预演：${draft.previsStudio.spec.durationSec}秒、${draft.previsStudio.spec.actors.length}名人物、${draft.previsStudio.spec.cameras.length}个机位。分镜原文未提供锁秒；请在本段实际时长内编排。` : "尚未建立白模。",
    blockers: issues.map(i => i.text),
  });
  return { context, issues, selectionLabel: "当前数字人制作稿", contextNotes: [], recommend3d: null, videoPromptDrafts: [] };
}
