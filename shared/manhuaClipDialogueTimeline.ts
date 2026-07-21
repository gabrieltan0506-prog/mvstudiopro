/**
 * 成片段内对白时间轴：第几秒出现 + 情绪/微表情/语气。
 * 供 Seedance 等段成片注入；静帧路径不使用。
 */

import { extractManhuaPerformanceCue } from "./manhuaPerformancePrompt.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";

export type ManhuaDialogueTimelineBeat = {
  shotIndex: number;
  startSec: number;
  endSec: number;
  dialogueZh: string;
  emotionZh: string;
  microExpressionZh: string;
  voiceToneZh: string;
};

function resolveShotDialogue(shot: ManhuaWorkbenchShot): string {
  const direct = String(shot.dialogueZh || "").trim();
  if (direct) return direct.slice(0, 80);
  return extractManhuaPerformanceCue(shot.actionZh).dialogueZh.slice(0, 80);
}

/** 按段时长均分镜位，得到对白节拍（含无台词但有情绪的镜） */
export function buildManhuaDialogueTimelineBeats(
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
): ManhuaDialogueTimelineBeat[] {
  const list = Array.isArray(shots) ? shots.filter(Boolean) : [];
  if (!list.length) return [];
  const dur =
    typeof durationSec === "number" && durationSec > 0
      ? Math.round(durationSec * 10) / 10
      : 15;
  const n = list.length;
  const slot = dur / n;
  return list.map((s, i) => {
    const startSec = Math.round(i * slot * 10) / 10;
    const endSec = Math.round(Math.min(dur, (i + 1) * slot) * 10) / 10;
    const fromAction = extractManhuaPerformanceCue(s.actionZh);
    return {
      shotIndex: s.index,
      startSec,
      endSec,
      dialogueZh: resolveShotDialogue(s),
      emotionZh: String(s.emotionZh || fromAction.emotionZh || "").trim().slice(0, 48),
      microExpressionZh: String(s.microExpressionZh || fromAction.microExpressionZh || "")
        .trim()
        .slice(0, 64),
      voiceToneZh: String(s.voiceToneZh || fromAction.voiceToneZh || "").trim().slice(0, 40),
    };
  });
}

/** 写入成片 prompt 的对白时间轴块 */
export function formatManhuaDialogueTimelineBlock(
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
  opts?: { segmentIndex?: number },
): string {
  const beats = buildManhuaDialogueTimelineBeats(shots, durationSec);
  const withContent = beats.filter(
    (b) => b.dialogueZh || b.emotionZh || b.microExpressionZh || b.voiceToneZh,
  );
  if (!withContent.length) {
    return [
      "【成片对白时间轴】",
      "本段暂无结构化台词：用呼吸、视线与微表情撑情绪；若节拍有台词请补写后再生成。",
    ].join("\n");
  }
  const seg =
    typeof opts?.segmentIndex === "number" && opts.segmentIndex >= 1
      ? `·第${opts.segmentIndex}段`
      : "";
  const lines = withContent.map((b) => {
    const parts = [
      `约 ${b.startSec}–${b.endSec}s`,
      `镜${b.shotIndex}`,
      b.dialogueZh ? `对白「${b.dialogueZh}」` : "无对白（气口/反应）",
      b.emotionZh ? `情绪 ${b.emotionZh}` : "",
      b.microExpressionZh ? `微表情 ${b.microExpressionZh}` : "",
      b.voiceToneZh ? `语气 ${b.voiceToneZh}` : "",
    ].filter(Boolean);
    return `- ${parts.join(" ｜ ")}`;
  });
  return [
    `【成片对白时间轴${seg}】`,
    "按秒演绎口型与气口；情绪/微表情须有可见差异；画面零字幕、零气泡。",
    ...lines,
  ].join("\n");
}

/** 跨镜/跨段防崩：脸、服装、场景（运镜画线是标配，连续才是生死线） */
export const MANHUA_CROSS_SHOT_CONTINUITY_LOCK = `【跨镜连续硬锁·防崩】
1. 脸：五官比例、年龄感、发型轮廓与本段参考静帧（及上一段末帧若有）为同一人，禁止换脸、整容式漂移、眼神年龄跳变。
2. 服装：款式、主色块、领口袖型、配饰与静帧一致，禁止中途换装、衣料突变或错时代穿戴。
3. 场景：地点材质、内外光色、纵深层次与静帧一致；段间接戏须承接空间，禁止下一秒跳棚/换地。
4. 道具：点选信物手持与落点连续，禁止瞬移失踪或无因变形。
5. 运镜/动作轨为调度辅助；连续失败时优先保脸与服装，再谈炫技运镜。`;
