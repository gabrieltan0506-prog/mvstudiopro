/**
 * Seedance 成片导戏单（feel.mp4 课 + 配音能力）：
 * 一轮生成写清——何时、说什么（含配音语气）、什么场景、切哪一镜、怎么运镜。
 * 静帧路径不使用对白字面。
 */

import {
  extractManhuaPerformanceCue,
  extractManhuaSpeakerAtTag,
  formatManhuaLockedDialogueLine,
} from "./manhuaPerformancePrompt.js";
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
  /** 说话人 @角色N */
  speakerAtTag: string;
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

/** 从静帧/成片 prompt 抽出主场景名（写入导戏单） */
export function extractManhuaSceneHintFromPrompt(prompt?: string | null): string {
  const raw = String(prompt || "");
  const m =
    raw.match(/【本集主场景优先】([^\n]+)/) ||
    raw.match(/【漫剧场景资产库[^\]]*】\s*([^\n]+)/);
  return (m?.[1] || "").trim().replace(/[：:].*$/, "").slice(0, 80);
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
    const dialogueZh = resolveShotDialogue(s);
    return {
      shotIndex: s.index,
      startSec,
      endSec,
      durationSec: durationBeat > 0 ? durationBeat : slot,
      cameraZh: String(s.cameraZh || "").trim(),
      actionZh: String(s.actionZh || "").trim().slice(0, 120),
      dialogueZh,
      emotionZh: String(s.emotionZh || fromAction.emotionZh || "").trim().slice(0, 48),
      microExpressionZh: String(s.microExpressionZh || fromAction.microExpressionZh || "")
        .trim()
        .slice(0, 64),
      voiceToneZh: String(s.voiceToneZh || fromAction.voiceToneZh || "").trim().slice(0, 40),
      speakerAtTag: extractManhuaSpeakerAtTag(
        s.dialogueZh,
        s.actionZh,
        fromAction.speakerAtTag,
      ),
    };
  });
}

/**
 * Seedance 视频生成导戏单：时间 / 配音台词 / 场景动作 / 切镜 / 运镜 一次写全。
 */
export function formatManhuaDialogueTimelineBlock(
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
  opts?: { segmentIndex?: number; sceneHintZh?: string },
): string {
  const beats = buildManhuaDialogueTimelineBeats(shots, durationSec);
  const sceneHint = String(opts?.sceneHintZh || "").trim();
  if (!beats.length) {
    return [
      "【视频生成导戏单·一轮】",
      "本段暂无分镜：请先写节拍后再生成；改对白只重出本段，禁止整集重烧。",
    ].join("\n");
  }
  const seg =
    typeof opts?.segmentIndex === "number" && opts.segmentIndex >= 1
      ? `第${opts.segmentIndex}段`
      : "本段";
  const lines = beats.map((b, i) => {
    const frame = framingHint(b.cameraZh);
    const cut =
      i === 0
        ? "开场建立"
        : `自镜${beats[i - 1]!.shotIndex}切到镜${b.shotIndex}（承接落点）`;
    const head = `分镜${b.shotIndex}｜${frame}｜${b.durationSec}秒｜约${b.startSec}–${b.endSec}s｜切镜：${cut}`;
    const lockedDialogue = formatManhuaLockedDialogueLine({
      speakerAtTag: b.speakerAtTag,
      dialogueZh: b.dialogueZh,
      emotionZh: b.emotionZh,
      microExpressionZh: b.microExpressionZh,
      voiceToneZh: b.voiceToneZh,
    });
    const voiceLine = lockedDialogue
      ? `配音/对白（须出声+口型同步，人物锁+表情一体）：${lockedDialogue}`
      : "配音：本镜无台词，保留环境气口/呼吸，勿乱加旁白";
    const bodyParts = [
      b.cameraZh ? `运镜：${b.cameraZh}（写清起幅→落幅）` : "运镜：承接上镜做可读微动",
      sceneHint ? `场景：${sceneHint}` : "",
      b.actionZh ? `场面动作：${b.actionZh}` : "",
      b.speakerAtTag ? `说话人锁：${b.speakerAtTag}` : "",
      b.microExpressionZh ? `微表情差：${b.microExpressionZh}` : "",
      voiceLine,
      b.emotionZh ? `情绪弧：${b.emotionZh}` : "",
    ].filter(Boolean);
    return `${head}\n  ${bodyParts.join("\n  ")}`;
  });
  return [
    `【视频生成导戏单·${seg}·一轮】`,
    `本段一条成片约 ${durationSec} 秒，必须同时生成画面与对白配音（有声轨）。`,
    "每镜写清：时间轴｜切镜｜运镜起落｜场景｜动作/微表情｜配音台词与语气。按秒执行，勿只演画面哑巴戏。",
    "画面零字幕、零气泡；对白只走口型与有声配音。改台词只重出本段，勿整集重烧。",
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

/** Seedance 成片总硬锁：配音+导戏字段 */
export const MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK = `【成片配音与导戏硬锁】
1. 必须出声：有对白的镜须生成角色配音，口型与气口对齐台词与语气；禁止纯画面哑巴戏。
2. 时间轴优先：按导戏单秒位说话/沉默，勿把所有台词堆在片头或片尾。
3. 切镜与运镜：景别切换与起落幅按导戏单执行，勿无因跳切。
4. 场景连续：材质光色锁参考静帧；情绪变化靠表演与光色微调，勿跳棚。
5. 画面仍禁止烧字幕/气泡；配音走声轨与口型。`;
