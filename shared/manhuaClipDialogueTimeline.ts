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
import {
  matchManhuaCameraMoveByNameZh,
  recommendManhuaCameraMoveFromText,
} from "./manhuaCameraMoveBank.js";
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
  const beats = list.map((s, i) => {
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
  /**
   * 独白补名：整段只有一位开口者时，没点名的台词也归到他头上。
   * 光秃「说『…』」句在成片里没有主语，口型与锁脸都挂不上；
   * 多人对戏不猜——猜错比不写更糟，靠编剧引导点名（manhuaEpisodeSegmentPlan）。
   */
  const speakers = new Set(
    beats.filter((b) => b.dialogueZh && b.speakerAtTag).map((b) => b.speakerAtTag),
  );
  if (speakers.size === 1) {
    const only = Array.from(speakers)[0]!;
    for (const b of beats) {
      if (b.dialogueZh && !b.speakerAtTag) b.speakerAtTag = only;
    }
  }
  return beats;
}

/** 顺句白描要靠逗号串起来；原文自带的句末标点会撞出「。。」 */
function trimTrailPunct(text: string): string {
  return String(text || "").trim().replace(/[。．.，,；;、\s]+$/, "");
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

/**
 * 纯运镜词开头的短句：可拍表常把「极速拉远，」写进动作栏，
 * 而运镜栏另有一套（缓慢推近），两条一起进提示词就是自相矛盾的指令。
 * 整段头必须全是运镜词才剥，避免误伤「推开门」这类真动作。
 */
const CAMERA_ONLY_HEAD_RE =
  /^[极缓轻慢快大小徐急]*(?:速)?(?:推近|推进|拉远|拉近|横移|平移|环绕|过肩跟拍|过肩|跟拍|手持微晃|手持|固定机位|固定|升格|降格|俯拍|仰拍|俯视|仰视|平视|微晃|摇镜|甩镜|变焦|长焦|广角|推|拉|摇|移|跟|升|降|俯|仰|晃)+$/;

/** 动作栏若以纯运镜词起头，且运镜栏已有权威值，就把它剥掉 */
function stripLeadingCameraDirection(actionZh: string, hasCameraField: boolean): string {
  if (!hasCameraField) return actionZh;
  const m = actionZh.match(/^([^，,。；;]{1,8})[，,]\s*([\s\S]+)$/);
  if (!m) return actionZh;
  return CAMERA_ONLY_HEAD_RE.test(m[1]!.trim()) ? m[2]!.trim() : actionZh;
}

/**
 * 两拍时序展开：单镜 ≥4s 且解析到带 sequenceZh 的库内条目（可拍表点名或推荐兜底），
 * 机位子句写成「先A，后B」时序，不再只落「推拉结合」这类孤零零标签。
 * 可拍表自己写了时序标记（先/后/再/接着）时原样放行，不替编剧改调度。
 */
function resolveBeatCameraSequenceZh(
  cameraZh: string,
  actionZh: string,
  durationSec: number,
): string | null {
  if (durationSec < 4) return null;
  const raw = String(cameraZh || "").trim();
  if (/先|后|再|接着|然后/.test(raw)) return null;
  const entry = raw
    ? matchManhuaCameraMoveByNameZh(raw)
    : recommendManhuaCameraMoveFromText(actionZh);
  const seq = entry?.sequenceZh;
  if (!seq) return null;
  return `先${trimTrailPunct(seq[0].replace(/^先/, ""))}，后${trimTrailPunct(seq[1].replace(/^[后再]/, ""))}`;
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
 * Seedance 秒轴：每镜必须列出动作轨迹 / 运镜轨迹 / 景别，并带表演三维（情绪 /
 * 微表情 / 语气）——只给台词内容不给演法，引擎只会念台词、不会演。
 * 例：`0–5s：动作轨迹：握拳对峙，咬牙。运镜轨迹：微推。景别：近景。情绪：怒。@角色2以压嗓说「放开！」。`
 * 身份靠垫图/@图片N；光学 mm/快门出片时另转。
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
  const emotionOf = (b: ManhuaDialogueTimelineBeat) => String(b.emotionZh || "").trim();
  const microOf = (b: ManhuaDialogueTimelineBeat) =>
    String(b.microExpressionZh || "").trim();
  const toneOf = (b: ManhuaDialogueTimelineBeat) => String(b.voiceToneZh || "").trim();
  /**
   * 某一维全镜逐字相同 = 段级默认灌进了每一镜（如三镜都写「眼神由惊转硬」）。
   * 提到段头写一次，别在秒轴复读——复读会盖掉真正的镜间差异。
   *
   * 三维各自判定而非合成一个值：常见情况是情绪贯穿全段、微表情逐镜递进，
   * 合起来一刀切会把递进的那一维也当成复读吞掉。
   */
  const pickShared = (of: (b: ManhuaDialogueTimelineBeat) => string) => {
    const first = of(beats[0]!);
    return beats.length > 1 && first && beats.every((b) => of(b) === first) ? first : "";
  };
  const sharedEmotion = pickShared(emotionOf);
  const sharedMicro = pickShared(microOf);
  const sharedTone = pickShared(toneOf);

  const lines = beats.map((b) => {
    const frame = extractManhuaFramingLabelZh(b.cameraZh, b.actionZh);
    const traj = cameraTrajectoryZh(b.cameraZh, b.actionZh);
    const speaker = b.speakerAtTag;
    let action = stripLeadingCameraDirection(
      String(b.actionZh || "")
        .replace(/[「『"“][^」』"”]{0,200}[」』"”]/g, "")
        .replace(/@角色\d+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      Boolean(String(b.cameraZh || "").trim()),
    );
    if (!action) action = "承接上镜动作";
    // 微表情贴着动作走（眼神/下颌/喉结本就是可见动作细节）；情绪是驱动它的
    // 内在状态，单列一栏。两者同值时只留微表情，它更具体。
    const micro = sharedMicro ? "" : microOf(b);
    const emotionRaw = sharedEmotion ? "" : emotionOf(b);
    const emotion = emotionRaw && emotionRaw !== micro ? emotionRaw : "";
    const tone = sharedTone ? "" : toneOf(b);
    const line = stripManhuaSpeakerAtPrefix(b.dialogueZh).trim();
    // 光与氛围是段级常量，段头【光影·景别·氛围】已写；每镜再复读一遍，
    // 15s 三镜就让同一串配色出现五次，纯占 token 又稀释镜级信息。
    /**
     * 官方示例是「时间标记 + 顺句白描」，我们原先发的是「动作轨迹：X。运镜轨迹：
     * Y。景别：Z。」这种字段表。信息量一样，但填空题式的标签会稀释画面感，
     * 模型读到的更像表格而不是镜头。改成按「先架机位、再走动作、后落台词」顺叙。
     */
    // 机位先行、以分号收口：既是顺读的镜头交代，也让引擎光学能把它认回来
    const seqZh = resolveBeatCameraSequenceZh(b.cameraZh, b.actionZh, b.durationSec);
    const camera = seqZh
      ? [frame, seqZh].filter(Boolean).join("·")
      : [frame, traj].filter(Boolean).map(trimTrailPunct).join("");
    const bits = [
      trimTrailPunct(action),
      micro ? trimTrailPunct(micro) : "",
      emotion ? trimTrailPunct(emotion) : "",
      // 语气决定「怎么说」，是口型与气口的依据；只给台词内容等于让引擎自己猜演法
      line
        ? `${speaker ? trimTrailPunct(speaker) : ""}${tone ? `以${trimTrailPunct(tone)}` : ""}说「${line}」`
        : trimTrailPunct(speaker),
    ].filter(Boolean);
    const head = `${b.startSec}–${b.endSec}s：`;
    if (!bits.length) return `${head}${camera}。`;
    return camera ? `${head}${camera}；${bits.join("，")}。` : `${head}${bits.join("，")}。`;
  });

  const sharedBits = [
    sharedEmotion ? `情绪：${sharedEmotion}` : "",
    sharedMicro && sharedMicro !== sharedEmotion ? `微表情：${sharedMicro}` : "",
    sharedTone ? `语气：${sharedTone}` : "",
  ].filter(Boolean);
  const toneLine = sharedBits.length
    ? `【表演基调】${sharedBits.join("｜")}（贯穿本段）。`
    : "";
  return [toneLine, ...lines].filter(Boolean).join("\n");
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
  // 光与氛围只在段头写一次，秒轴不再复读；缺段级光影时也别谎称「按秒轴各镜执行」
  const lightBoard = `【光影·景别·氛围】${
    [lighting, palette ? `配色${palette}` : ""].filter(Boolean).join("｜") ||
    "沿用本段垫图的光色；景别按秒轴各镜执行"
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
