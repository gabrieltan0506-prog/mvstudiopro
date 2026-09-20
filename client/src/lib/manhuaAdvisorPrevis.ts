import { manhuaPrevisSpecSchema, PREVIS_ACTION_LABELS } from "@shared/manhuaPrevis";
import type { CanvasBlock } from "./canvasTypes";

/** 只投影编辑规格；不发送媒体URL、模型存储位置、历史附件或未读取的画面。 */
export function buildAdvisorPrevisSummary(blocks: CanvasBlock[]): string {
  const clips = blocks.filter(b => !b.archivedFromPreviousScript && b.id.startsWith("clip-") && b.previsStudio);
  if (!clips.length) return "没有可读取的当前白模规格。不能判断白模角色、动作或视频质量。";
  const lines = ["仅当前白模编辑规格，未读取或播放实际视频。坐标/时间覆盖可检查；实际遮挡、穿模、接触受力、快慢观感必须逐帧及常速审片。"];
  for (const clip of clips) {
    const studio = clip.previsStudio!;
    const spec = studio.spec;
    const validation = manhuaPrevisSpecSchema.safeParse(spec);
    lines.push(`片段 ${clip.id}：${spec.durationSec}秒，${spec.actors.length}人，${spec.cameras.length}个机位。${validation.success ? "规格约束通过，不代表画面通过。" : `规格缺口：${validation.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("；")}`}`);
    for (const actor of spec.actors) {
      lines.push(`角色 ${actor.id} ${actor.nameZh}：形体${actor.shape}，起点${JSON.stringify(actor.start)}→终点${JSON.stringify(actor.end)}，移动${actor.moveStartSec}—${actor.moveEndSec}秒，持物${actor.weapon === "practice_sword" ? "练习剑" : "规格未绑定道具"}，带骨模型${actor.riggedModel ? "有" : "无"}。`);
      if (actor.motionRoute?.length) lines.push(`路线：${actor.motionRoute.map(n => `${n.timeSec}秒${JSON.stringify(n.position)}朝向${n.facingDeg}度`).join("；")}`);
      lines.push(`动作：${actor.actions.map(a => `${a.startSec}—${a.endSec}秒${PREVIS_ACTION_LABELS[a.kind]}${a.lookAtId ? `注视${a.lookAtId}` : ""}${a.facingDeg != null ? `朝向${a.facingDeg}度` : ""}`).join("；") || "无独立动作"}`);
    }
    lines.push(`接触事件：${spec.interactions?.map(e => `${e.actorId}→${e.targetActorId} ${e.kind} 起${e.startSec}/接触${e.contactSec}/收${e.endSec}秒`).join("；") || "未设置，不代表画面已发生接触"}`);
    lines.push(`机位：${spec.cameras.map(c => `${c.startSec}—${c.endSec}秒，位置${JSON.stringify(c.position)}→${JSON.stringify(c.endPosition || c.position)}，看向${JSON.stringify(c.target)}→${JSON.stringify(c.endTarget || c.target)}，环绕${c.orbitDeg || 0}度，镜头${c.lens}mm`).join("；")}`);
    if (spec.waterEmergence) lines.push(`出水事件：${spec.waterEmergence.events.map(e => `${e.actorId}在${e.crossSec}秒出水，上升${e.riseSec}秒`).join("；")}`);
    if (spec.scriptSource?.unmappedShotIndices.length) lines.push(`未映射原剧本镜号：${spec.scriptSource.unmappedShotIndices.join("、")}`);
    lines.push(`节奏文字说明：${studio.draftTempoZh || "无"}；文字说明不证明渲染已执行慢动作或子弹时间。`);
    lines.push("角色在场仅为规格列名，画外去向/进出画/剧本角色遗漏需对照本集正文；未建模道具不能当已绑定。");
  }
  return lines.join("\n");
}
