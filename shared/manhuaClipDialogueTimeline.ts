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
  if (/中近景/.test(c)) return "中近景";
  if (/近景/.test(c)) return "近景";
  if (/中全景|中远景/.test(c)) return "中远景";
  if (/远景|全景/.test(c)) return "全景";
  if (/中景/.test(c)) return "中景";
  // 无景别词时默认近景；禁止把动作原文当成景别
  return "近景";
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

/** 从运镜句抽出景别（全景/中景/近景…） */
export function extractManhuaFramingLabelZh(cameraZh: string, actionZh = ""): string {
  return framingHint(`${cameraZh || ""} ${actionZh || ""}`.trim());
}

/** 运镜轨迹：去掉已单列的景别词，保留推拉摇移等动势 */
function cameraTrajectoryZh(cameraZh: string, actionZh: string): string {
  const raw = resolveBeatCameraMoveZh(cameraZh, actionZh);
  const frame = extractManhuaFramingLabelZh(cameraZh, actionZh);
  let move = raw
    .replace(new RegExp(frame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(/[·•|｜]/g, " ")
    .replace(/^[，,、\s]+|[，,、\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!move || move === frame) {
    // 仍无动势时，用原句或默认微动
    move = /推|拉|摇|移|跟|升|降|环绕|手持|固定|微动|平视|仰|俯/.test(raw)
      ? raw.replace(frame, "").replace(/^[，,、\s]+/, "").trim() || "固定微动"
      : "固定微动";
  }
  return move.slice(0, 48);
}

/**
 * Seedance 秒轴：每镜必须列出动作轨迹 / 运镜轨迹 / 景别，并可带光与氛围。
 * 例：`0–5s：动作轨迹：…。运镜轨迹：缓推。景别：近景。光：侧逆。氛围：压迫。@角色2说「…」。`
 * 身份靠垫图/@Image；光学 mm/快门出片时另转。
 */
export function formatManhuaDialogueTimelineBlock(
  shots: ManhuaWorkbenchShot[],
  durationSec: number,
  opts?: {
    segmentIndex?: number;
    sceneHintZh?: string;
    /** 段级光影/运镜（可拍表），拆到各镜光/氛围兜底 */
    lightingCameraZh?: string;
    paletteZh?: string;
  },
): string {
  const beats = buildManhuaDialogueTimelineBeats(shots, durationSec);
  if (!beats.length) return "本段暂无分镜。";
  const segLight = String(opts?.lightingCameraZh || "").trim();
  const segPalette = String(opts?.paletteZh || "").trim();
  const lightFallback =
    segLight
      .split(/[；;|｜]/)
      .map((s) => s.trim())
      .find((s) => /光|灯|逆|侧|顶|火|烛|霓虹|阴|亮|暗/.test(s)) ||
    (segLight ? segLight.slice(0, 36) : "");
  const moodFallback =
    segPalette.slice(0, 36) ||
    segLight
      .split(/[；;|｜]/)
      .map((s) => s.trim())
      .find((s) => /氛围|压迫|紧张|冷|暖|雨|夜|肃|诡/.test(s)) ||
    "";

  return beats
    .map((b) => {
      const frame = extractManhuaFramingLabelZh(b.cameraZh, b.actionZh);
      const traj = cameraTrajectoryZh(b.cameraZh, b.actionZh);
      const speaker = b.speakerAtTag;
      let action = String(b.actionZh || "")
        .replace(/[「『"“][^」』"”]{0,200}[」』"”]/g, "")
        .replace(/@角色\d+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!action) action = "承接上镜动作";
      const visible =
        String(b.microExpressionZh || "").trim() ||
        String(b.emotionZh || "").trim();
      const line = stripManhuaSpeakerAtPrefix(b.dialogueZh).trim();
      const light = lightFallback;
      const mood = moodFallback || visible;
      const bits = [
        `动作轨迹：${action}${visible ? `，${visible}` : ""}`,
        `运镜轨迹：${traj}`,
        `景别：${frame}`,
        light ? `光：${light}` : "",
        mood ? `氛围：${mood}` : "",
        speaker || "",
        line ? `说「${line}」` : "",
      ].filter(Boolean);
      return `${b.startSec}–${b.endSec}s：${bits.join("。")}。`;
    })
    .join("\n");
}

/**
 * 段头场景锁 + 光影景别氛围（短板，非规则墙）。
 * 场景必须说明地点/天气/关键陈设，并提示锁垫图/@场景。
 */
export function formatManhuaClipSceneLightBoard(input: {
  segmentIndex: number;
  durationSec: number;
  sceneHintZh?: string | null;
  sceneDetailZh?: string | null;
  paletteZh?: string | null;
  lightingCameraZh?: string | null;
  sceneTag?: string | null;
}): string {
  const seg = Math.max(1, Math.floor(input.segmentIndex));
  const dur =
    typeof input.durationSec === "number" && input.durationSec > 0
      ? Math.round(input.durationSec * 10) / 10
      : 15;
  const sceneName = String(input.sceneHintZh || "").trim();
  const detail = String(input.sceneDetailZh || "").trim();
  const palette = String(input.paletteZh || "").trim();
  const lighting = String(input.lightingCameraZh || "").trim();
  const sceneTag = String(input.sceneTag || "").trim();
  const head = sceneName
    ? `【第${seg}段·${dur}s】${sceneName}`
    : `【第${seg}段·${dur}s】`;
  const sceneBody = [sceneName, detail].filter(Boolean).join("｜") || "本段主场（须与垫图场一致）";
  const sceneLock = `【场景锁】${sceneBody}${
    palette ? `；配色：${palette}` : ""
  }。地点材质光色锁本段垫图${sceneTag ? `与${sceneTag}` : ""}，禁止跳棚换地。`;
  const lightBoard = `【光影·景别·氛围】${
    [lighting, palette ? `配色${palette}` : ""].filter(Boolean).join("｜") ||
    "按秒轴各镜：光 / 景别 / 氛围执行"
  }。`;
  return [head, sceneLock, lightBoard].join("\n");
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
