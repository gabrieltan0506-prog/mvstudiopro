import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench";

/** 从当前段真实分镜起草配乐情绪线；不生成音乐，也不改写对白。 */
export function manhuaBgmArcFromShots(shots: ManhuaWorkbenchShot[], durationSec: number): string {
  if (!shots.length) return "";
  const ordered = [...shots].sort((a, b) => a.index - b.index);
  let elapsed = 0;
  const beats = ordered.map(shot => {
    const start = elapsed;
    elapsed += Math.max(0, Number.isFinite(shot.durationSec) ? shot.durationSec : 0);
    const detail = [shot.intentZh, shot.emotionZh, shot.actionZh].map(value => value?.trim()).filter(Boolean).join("；");
    const hasDialogue = !shot.dialogueSuppressed && Boolean(shot.dialogueZh?.trim() || shot.additionalDialogueCues?.some(cue => cue.dialogueZh.trim()));
    return `${start.toFixed(1)}–${elapsed.toFixed(1)}秒：${detail || "延续本段情绪"}${hasDialogue ? "；有人声对白，音乐降低存在感" : ""}`;
  });
  return `为本段约${durationSec}秒剧情写纯器乐配乐。随以下镜头推进情绪与力度，不加入人声、歌词或对白；对白处留空间，动作撞点短促，镜头转场不断裂。\n${beats.join("\n")}\n结尾按最后一镜的情绪收束，为下一段保留衔接空间。`;
}
