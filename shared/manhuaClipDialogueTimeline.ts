/**
 * Seedance 成片导戏单（feel.mp4 课）：
 * 一轮生成写清——何时、说什么（语气/口型）、什么场景、切哪一镜、怎么运镜。
 * 有声依赖引擎 Audio on，暂不做后期另配音轨。
 * 静帧路径不使用对白字面。
 */

import {
  extractManhuaPerformanceCue,
  extractManhuaSpeakerAtTag,
  stripManhuaSpeakerAtPrefix,
} from "./manhuaPerformancePrompt.js";
import { recommendManhuaCameraMoveFromText } from "./manhuaCameraMoveBank.js";
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
  if (direct) return direct;
  return extractManhuaPerformanceCue(shot.actionZh).dialogueZh;
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
      actionZh: String(s.actionZh || "").trim(),
      dialogueZh,
      emotionZh: String(s.emotionZh || fromAction.emotionZh || "").trim(),
      microExpressionZh: String(
        s.microExpressionZh || fromAction.microExpressionZh || "",
      ).trim(),
      voiceToneZh: String(s.voiceToneZh || fromAction.voiceToneZh || "").trim(),
      speakerAtTag: extractManhuaSpeakerAtTag(
        s.dialogueZh,
        s.actionZh,
        fromAction.speakerAtTag,
      ),
    };
  });
}

/** 运镜：景别+动势（用户说法）；禁止灌词库长解释 / mm / 快门 */
function resolveBeatCameraMoveZh(cameraZh: string, actionZh: string): string {
  const raw = String(cameraZh || "")
    .replace(/\s+/g, " ")
    .trim();
  if (raw) return raw;
  // 无运镜字段时：有景别/机位信号才补推荐名，否则只写「近景微动」
  const signal = `${actionZh}`;
  if (!/特写|近景|中景|全景|远景|仰|俯|推|拉|跟|环绕|过肩|手持/.test(signal)) {
    return "近景微动";
  }
  const frame = framingHint(signal);
  const move = recommendManhuaCameraMoveFromText(signal);
  const name = String(move.nameZh || "").trim();
  return [frame || "近景", name].filter(Boolean).join("·") || "近景微动";
}

/**
 * Seedance 风格秒轴（短指令，非聊天表格）：
 * `0–5s：@角色2 抬头，眼眶发红，说「…」。近景微推。`
 * 身份靠垫图/@Image；此处只调度可见动作、对白、运镜。
 * 光学 mm/快门出片时另转。
 */
export function formatManhuaDialogueTimelineBlock(
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
  opts?: { segmentIndex?: number; sceneHintZh?: string },
): string {
  const beats = buildManhuaDialogueTimelineBeats(shots, durationSec);
  if (!beats.length) return "本段暂无分镜。";
  return beats
    .map((b) => {
      const cam = resolveBeatCameraMoveZh(b.cameraZh, b.actionZh);
      const speaker = b.speakerAtTag;
      let action = String(b.actionZh || "")
        .replace(/[「『"“][^」』"”]{0,200}[」』"”]/g, "")
        .replace(/@角色\d+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!action) action = "承接上镜动作";
      // 可见表情优先；情绪名词只在无微表情时落到可见词（不硬截断，按镜内表演写全）
      const visible =
        String(b.microExpressionZh || "").trim() ||
        String(b.emotionZh || "").trim();
      const line = stripManhuaSpeakerAtPrefix(b.dialogueZh).trim();
      const bits = [
        speaker || "",
        action,
        visible,
        line ? `说「${line}」` : "",
      ].filter(Boolean);
      return `${b.startSec}–${b.endSec}s：${bits.join("，")}。${cam}。`;
    })
    .join("\n");
}

/** 跨镜/跨段防崩：脸、服装、场景 */
export const MANHUA_CROSS_SHOT_CONTINUITY_LOCK = `【跨镜连续硬锁·防崩】
1. 脸：五官比例、年龄感、发型轮廓与本段参考静帧（及上一段末帧若有）为同一人，禁止换脸、整容式漂移。
2. 服装：款式、主色块、领口袖型、配饰与静帧一致，禁止中途换装或错时代穿戴。
3. 场景：地点材质、内外光色与静帧一致；同场景别/站位变化可以，禁止下一秒跳棚换地。
4. 道具：点选信物手持与落点连续，禁止瞬移失踪。
5. 运镜画线是调度；连续失败时优先保脸与服装。`;

/** Seedance 成片总硬锁：引擎自带有声 + 导戏字段（暂不另做后期配音） */
export const MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK = `【成片有声与导戏硬锁】
1. 有声：有对白的镜须由成片引擎同轮出声（Audio on），口型与气口对齐台词与语气；禁止纯画面哑巴戏；禁止另开后期配音轨。
2. 时间轴优先：按导戏单秒位说话/沉默，勿把所有台词堆在片头或片尾。
3. 切镜与运镜：景别切换与起落幅按导戏单执行，勿无因跳切。
4. 场景连续：材质光色锁参考静帧；情绪变化靠表演与光色微调，勿跳棚。
5. 画面仍禁止烧字幕/气泡；对白只走引擎声轨与口型。`;
