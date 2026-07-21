/**
 * 成片表演脚本（feel.mp4 2026-07-21 重抽课）：
 * 一次生成吃完整段多镜——每镜：景别秒数｜运镜｜动作微表情｜台词语气情绪。
 * 静帧路径不使用本模块的对白字面。
 */

import { extractManhuaPerformanceCue } from "./manhuaPerformancePrompt.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";

export type ManhuaDialogueTimelineBeat = {
  shotIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  cameraZh: string;
  actionZh: string;
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

function framingHint(cameraZh: string): string {
  const c = String(cameraZh || "");
  if (/特写|大特写/.test(c)) return "特写";
  if (/近景|中近景/.test(c)) return "近景";
  if (/中全景|中远|远景|全景/.test(c)) return "中远景";
  if (/中景/.test(c)) return "中景";
  return c.trim() || "近景";
}

/** 按段时长均分镜位 */
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
    const durationBeat = Math.round((endSec - startSec) * 10) / 10;
    const fromAction = extractManhuaPerformanceCue(s.actionZh);
    return {
      shotIndex: s.index,
      startSec,
      endSec,
      durationSec: durationBeat > 0 ? durationBeat : slot,
      cameraZh: String(s.cameraZh || "").trim(),
      actionZh: String(s.actionZh || "").trim().slice(0, 120),
      dialogueZh: resolveShotDialogue(s),
      emotionZh: String(s.emotionZh || fromAction.emotionZh || "").trim().slice(0, 48),
      microExpressionZh: String(s.microExpressionZh || fromAction.microExpressionZh || "")
        .trim()
        .slice(0, 64),
      voiceToneZh: String(s.voiceToneZh || fromAction.voiceToneZh || "").trim().slice(0, 40),
    };
  });
}

/**
 * feel 式成片多镜剧本：一轮生成吃完整段。
 * 例：分镜1（近景 4秒 · 约0–4s）：过肩… 微表情… 语气：「台词」。情绪…
 */
export function formatManhuaDialogueTimelineBlock(
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
  opts?: { segmentIndex?: number },
): string {
  const beats = buildManhuaDialogueTimelineBeats(shots, durationSec);
  if (!beats.length) {
    return [
      "【成片表演剧本·一轮生成】",
      "本段暂无分镜：请先写节拍后再生成；改对白只重出本段，禁止整集重烧。",
    ].join("\n");
  }
  const seg =
    typeof opts?.segmentIndex === "number" && opts.segmentIndex >= 1
      ? `第${opts.segmentIndex}段`
      : "本段";
  const lines = beats.map((b) => {
    const frame = framingHint(b.cameraZh);
    const head = `分镜${b.shotIndex}（${frame} ${b.durationSec}秒 · 约${b.startSec}–${b.endSec}s）`;
    const bodyParts = [
      b.cameraZh ? `运镜 ${b.cameraZh}` : "",
      b.actionZh ? `动作 ${b.actionZh}` : "",
      b.microExpressionZh ? `微表情 ${b.microExpressionZh}` : "",
      b.dialogueZh
        ? `${b.voiceToneZh ? `语气${b.voiceToneZh}：` : ""}「${b.dialogueZh}」`
        : "无对白（呼吸/视线/沉默节拍）",
      b.emotionZh ? `情绪 ${b.emotionZh}` : "",
    ].filter(Boolean);
    return `${head}：${bodyParts.join("；")}`;
  });
  return [
    `【成片表演剧本·${seg}·一轮生成】`,
    "本段一条成片吃完整下列多镜；按秒位演口型、气口、微表情差与同场站位。画面零字幕、零气泡。",
    "改台词/情绪：只重出本段成片，勿整集分段重烧。",
    ...lines,
  ].join("\n");
}

/** 跨镜/跨段防崩：脸、服装、场景 */
export const MANHUA_CROSS_SHOT_CONTINUITY_LOCK = `【跨镜连续硬锁·防崩】
1. 脸：五官比例、年龄感、发型轮廓与本段参考静帧（及上一段末帧若有）为同一人，禁止换脸、整容式漂移。
2. 服装：款式、主色块、领口袖型、配饰与静帧一致，禁止中途换装或错时代穿戴。
3. 场景：地点材质、内外光色与静帧一致；同场景别/站位变化可以，禁止下一秒跳棚换地。
4. 道具：点选信物手持与落点连续，禁止瞬移失踪。
5. 运镜画线是调度；连续失败时优先保脸与服装。`;
