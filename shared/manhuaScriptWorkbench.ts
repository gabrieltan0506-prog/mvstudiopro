/**
 * 剧本工作台：从工厂节点文本推导「片段内多镜」列表，供批量静帧与成片对齐。
 */

import {
  formatManhuaPerformanceInjectBlock,
  mergeManhuaPerformanceCue,
  type ManhuaPerformanceCue,
} from "./manhuaPerformancePrompt.js";
import { formatRecommendedCameraMoveLine } from "./manhuaCameraMoveBank.js";
import {
  formatManhuaCameraAngleLine,
  getManhuaCameraAngle,
  recommendManhuaCameraAngleFromText,
} from "./manhuaCameraAngleBank.js";
import { MANHUA_CLIP_PREFLIGHT_BLOCK } from "./manhuaNarrativeEnginePrompt.js";

export type ManhuaWorkbenchShot = {
  index: number;
  durationSec: number;
  cameraZh: string;
  actionZh: string;
  /** 本镜台词（只作表演，不烧字） */
  dialogueZh?: string;
  /** 情绪弧：委屈不信 / 愧疚无力… */
  emotionZh?: string;
  /** 说话语气：沙哑、压哭腔… */
  voiceToneZh?: string;
  /** 微表情：眼眶发红泪未落… */
  microExpressionZh?: string;
  /** 机位密码 id（工作台点选；注入静帧/成片优先于文本推荐） */
  cameraAngleId?: string;
};

const DEFAULT_CAMERAS = [
  "全景，平视，缓慢推近",
  "中景，固定机位，三分构图",
  "中近景，轻微横移",
  "特写，平视，微推",
];

const CAMERA_TOKENS =
  "远景|大远景|全景|中全景|中景|中近景|近景|特写|大特写|过肩|双人镜头|双人镜";

/** @deprecated 仅兼容旧「整段 10s 均分」口径；新路径按段时长 */
export const MANHUA_SINGLE_CLIP_DURATION_SEC = 10;

/** Omni 每段成片秒数 */
export const MANHUA_OMNI_SEGMENT_DURATION_SEC = 10;
/** Seedance 2.0 / Fast 每段成片秒数 */
export const MANHUA_SEEDANCE_SEGMENT_DURATION_SEC = 15;

/** 一集默认段数（6×15s ≈ 90s） */
export const MANHUA_SEGMENT_DEFAULT = 6;
/** 每段静帧上限 */
export const MANHUA_KEYARTS_PER_SEGMENT_MAX = 5;
/** 每段静帧下限（默认骨架用 4） */
export const MANHUA_KEYARTS_PER_SEGMENT_MIN = 4;
/** 成片前按镜静帧上限 = 段数 × 每段上限 */
export const MANHUA_SHOT_KEYART_MAX =
  MANHUA_SEGMENT_DEFAULT * MANHUA_KEYARTS_PER_SEGMENT_MAX;

/** 工厂默认成片模型（产品默认；探针仍可另用 Mini） */
export const MANHUA_FACTORY_DEFAULT_VIDEO_MODEL = "seedance-2.0-fast" as const;

export function manhuaSegmentDurationSec(videoModel?: string | null): number {
  const m = String(videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL).trim();
  if (m === "gemini-omni-flash") return MANHUA_OMNI_SEGMENT_DURATION_SEC;
  return MANHUA_SEEDANCE_SEGMENT_DURATION_SEC;
}

export type ManhuaWorkbenchSegment = {
  /** 1-based 段号 */
  index: number;
  durationSec: number;
  /** 段内静帧（全局镜号 1..n） */
  shots: ManhuaWorkbenchShot[];
};

/** 将分镜列表收成段：无分镜时默认约 6 段 × 4 静帧；有分镜表则按 4 镜一段切，不强行注水 */
export function groupShotsIntoSegments(
  shots: ManhuaWorkbenchShot[],
  opts?: { videoModel?: string | null; segmentCount?: number; padToDefaultEpisode?: boolean },
): ManhuaWorkbenchSegment[] {
  const dur = manhuaSegmentDurationSec(opts?.videoModel);
  const per = MANHUA_KEYARTS_PER_SEGMENT_MIN;
  const explicit = shots.length >= 2;
  const padToDefault =
    opts?.padToDefaultEpisode === true || (!explicit && opts?.segmentCount == null);
  let list = (explicit ? shots : defaultWorkbenchShots()).map((s, i) => ({
    ...s,
    index: i + 1,
  }));
  if (padToDefault || opts?.segmentCount != null) {
    const targetSegs = Math.max(
      1,
      Math.min(12, Math.floor(opts?.segmentCount ?? MANHUA_SEGMENT_DEFAULT)),
    );
    const minTotal = targetSegs * per;
    while (list.length < minTotal) {
      const i = list.length;
      list.push({
        index: i + 1,
        durationSec: 0,
        cameraZh: DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
        actionZh: `段内补镜：承接上镜情绪与空间，推进可读动作 ${i + 1}`,
      });
    }
    list = list.slice(0, targetSegs * MANHUA_KEYARTS_PER_SEGMENT_MAX);
  } else {
    list = list.slice(0, MANHUA_SHOT_KEYART_MAX);
  }
  list = list.map((s, i) => ({ ...s, index: i + 1 }));

  const segs: ManhuaWorkbenchSegment[] = [];
  for (let i = 0; i < list.length; i += per) {
    const chunk = list.slice(i, i + per);
    if (!chunk.length) break;
    segs.push({ index: segs.length + 1, durationSec: dur, shots: chunk });
  }
  return segs.length ? segs : [{ index: 1, durationSec: dur, shots: list.slice(0, per) }];
}

/** 全局镜号 → 段号（1-based）；与 groupShotsIntoSegments 的每段 4 镜对齐 */
export function resolveSegmentIndexFromShotIndex(shotIndex: number): number {
  const s = Math.max(1, Math.floor(shotIndex));
  return Math.floor((s - 1) / MANHUA_KEYARTS_PER_SEGMENT_MIN) + 1;
}

/** 段号 → 该段全局镜号列表（默认每段 4 镜） */
export function shotIndexesForSegment(segmentIndex: number): number[] {
  const g = Math.max(1, Math.floor(segmentIndex));
  const start = (g - 1) * MANHUA_KEYARTS_PER_SEGMENT_MIN + 1;
  return Array.from({ length: MANHUA_KEYARTS_PER_SEGMENT_MIN }, (_, i) => start + i);
}

function looksLikeEnglishMotionOnly(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/[\u4e00-\u9fff]/.test(t)) return false;
  return /^(slow|push|pan|orbit|dolly|zoom|handheld|locked|whip|soft|cinematic|camera)\b/i.test(
    t,
  );
}

function splitCameraAndAction(rawBody: string): { cameraZh: string; actionZh: string } {
  const body = String(rawBody || "").trim();
  const m = body.match(
    new RegExp(`^(${CAMERA_TOKENS})\\s*[，,：:\\-|/]\\s*(.+)$`, "i"),
  );
  if (m?.[1] && m[2]) {
    return { cameraZh: m[1].trim(), actionZh: m[2].trim() };
  }
  const m2 = body.match(new RegExp(`^(${CAMERA_TOKENS})\\s+(.+)$`, "i"));
  if (m2?.[1] && m2[2] && m2[2].length > 2) {
    return { cameraZh: m2[1].trim(), actionZh: m2[2].trim() };
  }
  return { cameraZh: "", actionZh: body };
}

function extractStoryboardSection(text: string): string {
  const board = text.match(/##\s*分镜表\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (board?.[1]?.trim()) return board[1].trim();
  const beats = text.match(/##\s*(?:镜头节拍|节拍表|分镜)\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (beats?.[1]?.trim()) return beats[1].trim();
  return text;
}

type ParsedShotRow = {
  index: number;
  cameraZh: string;
  actionZh: string;
} & Partial<ManhuaPerformanceCue>;

function enrichRowWithPerformance(row: ParsedShotRow): ParsedShotRow {
  const cue = mergeManhuaPerformanceCue(
    {
      dialogueZh: row.dialogueZh,
      emotionZh: row.emotionZh,
      voiceToneZh: row.voiceToneZh,
      microExpressionZh: row.microExpressionZh,
      bodyBeatZh: row.bodyBeatZh,
    },
    `${row.cameraZh} ${row.actionZh}`,
  );
  return { ...row, ...cue };
}

function parseShotRowsFromText(raw: string): ParsedShotRow[] {
  const section = extractStoryboardSection(String(raw || "").trim());
  if (!section) return [];

  const lines = section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const byIndex = new Map<number, ParsedShotRow>();

  for (const line of lines) {
    if (/^\|?\s*[-:| ]+\s*\|?\s*$/.test(line)) continue;
    if (/镜号|景别|内容|镜头/.test(line) && /\|\s*镜|\|\s*景|\|\s*内/.test(line)) continue;

    // Markdown 表：| 1 | 近景 | 女主推门 | 或加台词/情绪列
    const table = line.match(
      /^\|\s*(\d{1,2})\s*\|\s*([^|]*)\|\s*([^|]*)\|(?:\s*([^|]*)\|)?(?:\s*([^|]*)\|)?/,
    );
    if (table?.[1] && table[3]) {
      const index = Math.max(1, parseInt(table[1], 10));
      const cameraCell = String(table[2] || "").trim();
      const actionCell = String(table[3] || "").trim();
      const dialogueCell = String(table[4] || "").trim();
      const emotionCell = String(table[5] || "").trim();
      if (looksLikeEnglishMotionOnly(actionCell)) continue;
      const split = splitCameraAndAction(
        cameraCell && actionCell ? `${cameraCell}：${actionCell}` : actionCell || cameraCell,
      );
      byIndex.set(
        index,
        enrichRowWithPerformance({
          index,
          cameraZh: split.cameraZh || cameraCell || "",
          actionZh: split.actionZh || actionCell,
          dialogueZh: dialogueCell.replace(/^[「『"“]|[」』"”]$/g, ""),
          emotionZh: emotionCell,
        }),
      );
      continue;
    }

    const numbered = line.match(
      /^(?:[-*•]\s*)?(?:分镜|镜头|节拍|Shot|SHOT)?\s*(\d{1,2})\s*[:：、.\)\]】]\s*(.+)$/i,
    );
    if (numbered?.[1] && numbered[2]) {
      const index = Math.max(1, parseInt(numbered[1], 10));
      const body = numbered[2].trim();
      if (looksLikeEnglishMotionOnly(body)) continue;
      if (body.length < 2) continue;
      const split = splitCameraAndAction(body);
      byIndex.set(
        index,
        enrichRowWithPerformance({
          index,
          cameraZh: split.cameraZh,
          actionZh: split.actionZh,
        }),
      );
    }
  }

  return Array.from(byIndex.values())
    .sort((a, b) => a.index - b.index)
    .slice(0, MANHUA_SHOT_KEYART_MAX);
}

/** 从节拍 / 反推正文拆出多镜；失败则回落为「约 6 段 × 4 静帧」骨架 */
export function parseWorkbenchShotsFromText(raw: string | undefined | null): ManhuaWorkbenchShot[] {
  const text = String(raw || "").trim();
  if (!text) return defaultWorkbenchShots();

  const rows = parseShotRowsFromText(text);
  if (rows.length < 2) return defaultWorkbenchShots(text.slice(0, 180));

  // 重新编号为 1..n；单镜秒数仅作占位，成片时长按段模型
  return rows.slice(0, MANHUA_SHOT_KEYART_MAX).map((row, i) => ({
    index: i + 1,
    durationSec: 0,
    cameraZh: row.cameraZh || DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
    actionZh: row.actionZh.slice(0, 280),
    dialogueZh: row.dialogueZh || undefined,
    emotionZh: row.emotionZh || undefined,
    voiceToneZh: row.voiceToneZh || undefined,
    microExpressionZh: row.microExpressionZh || undefined,
  }));
}

export function defaultWorkbenchShots(seedAction?: string): ManhuaWorkbenchShot[] {
  const base = String(seedAction || "").trim();
  const beatSeeds = base
    ? [
        `开场交代：${base.slice(0, 80)}`,
        "人物进场，情绪与关系落点",
        "冲突或信息转折",
        "钩子收束，留未解悬念",
      ]
    : [
        "开场建立场景与人物位置",
        "人物互动，推进本集主冲突",
        "情绪/信息转折点",
        "集末钩子，引导下一集",
      ];
  const total = MANHUA_SEGMENT_DEFAULT * MANHUA_KEYARTS_PER_SEGMENT_MIN;
  return Array.from({ length: total }, (_, i) => {
    const seg = Math.floor(i / MANHUA_KEYARTS_PER_SEGMENT_MIN) + 1;
    const inSeg = (i % MANHUA_KEYARTS_PER_SEGMENT_MIN) + 1;
    return {
      index: i + 1,
      durationSec: 0,
      cameraZh: DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
      actionZh:
        inSeg === 1
          ? `第${seg}段起幅：${beatSeeds[(seg - 1) % beatSeeds.length]}`
          : `第${seg}段第${inSeg}镜：承接上镜，推进可读动作与关系变化`,
    };
  });
}

function splitDurations(totalSec: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [totalSec];
  const base = Math.floor((totalSec * 10) / n) / 10;
  const out = Array.from({ length: n }, () => base);
  let sum = out.reduce((a, b) => a + b, 0);
  out[out.length - 1] = Math.round((out[out.length - 1]! + (totalSec - sum)) * 10) / 10;
  return out;
}

export function workbenchShotTotalSec(
  shots: ManhuaWorkbenchShot[],
  videoModel?: string | null,
): number {
  const segs = groupShotsIntoSegments(shots, { videoModel });
  return Math.round(segs.reduce((s, x) => s + x.durationSec, 0) * 10) / 10;
}

/** 从场面文案推断同框人数（用于静帧硬锁） */
export function inferWorkbenchShotCastCount(actionZh: string): number {
  const t = String(actionZh || "");
  if (/群像|众人|一群|多名|围观|弟子们/.test(t)) return 3;
  if (/三人|三人对/.test(t)) return 3;
  if (
    /两人|双人|男女|对视|对峙|交锋|对决|递.+给|并肩|同框|并肩而立|主仆|夫妻|母女|父子|兄妹|姐妹|师徒|宾主|一旁/.test(
      t,
    )
  ) {
    return 2;
  }
  return 1;
}

/** 静帧禁字：避免设定卡/字幕污染后续质检（中文硬锁，写入 keyart prompt） */
export const MANHUA_KEYART_NO_TEXT_LOCK =
  "禁字硬锁：画面必须是纯视觉电影静帧，零可读文字。禁止字幕、对白气泡、旁白条、水印、Logo、姓名条、设定卡多格、UI 文案、标题大字、镜号数字、印章题跋；对白/旁白只作表演依据，绝不能烧进画面；工牌/手机/文件/霓虹仅几何光斑或完全模糊不可辨认字形。";

/** 生图最终英文提示词追加（模型对英文 negative 更听话） */
export const MANHUA_KEYART_NO_TEXT_EN =
  "STRICT NO TEXT: pure cinematic still only. Zero readable letters, Chinese characters, numbers, subtitles, captions, speech bubbles, logos, watermarks, nameplates, UI panels, title cards, or signage glyphs. Any dialogue is acting direction only — never painted on the image. Screens/badges/papers = blank glow or illegible blur only.";

/** 写入静帧 prompt：本镜场面必须带场景/道具/服装配合 */
export function formatWorkbenchShotInjectBlock(shot: ManhuaWorkbenchShot): string {
  const camera = String(shot.cameraZh || "").trim();
  const action = String(shot.actionZh || "").trim();
  const framingLock = /全景|远景/.test(camera)
    ? "景别硬锁：全景/远景；人物必须全身入画，并清楚展示环境纵深与人物空间关系，禁止裁到腰部或大腿。"
    : /中近景/.test(camera)
      ? "景别硬锁：中近景；主体以胸部以上为主，保留动作方向，禁止退回普通半身中景。"
      : /特写|大特写/.test(camera)
        ? "景别硬锁：特写；面部表情或关键道具必须占画面主体，禁止生成半身或全身中景。"
        : /中景|中全景/.test(camera)
          ? "景别硬锁：中景；人物动作与关系清楚可读；若指定三分构图，主体必须落在三分线交点，禁止中心对称海报构图。"
          : /近景/.test(camera)
            ? "景别硬锁：近景；肩部以上为主，表情与视线方向可读。"
            : /双人/.test(camera)
              ? "景别硬锁：双人镜头；两人同框、关系轴线清楚，禁止裁成单人肖像。"
              : "";
  const castCount = inferWorkbenchShotCastCount(shot.actionZh);
  const castLock =
    castCount >= 3
      ? "人数硬锁：本镜为群像/多人场面，须同框出现三位及以上可读人物，禁止只画单人半身定妆像。"
      : castCount >= 2
        ? "人数硬锁：本镜为双人/关系场面，须同框出现至少两名身份可辨的人物（含对视、对峙、递接、并肩），禁止只保留单人肖像或单人特写糊弄。"
        : "人数提示：若分镜动作涉及第二人，必须同框画出，不得省略成单人空镜肖像。";
  const sceneShiftHint = /切到|转场|外景|内景|门外|窗|殿|庙|街|台/.test(action)
    ? "场景变换：若动作含空间跳转，画面须交代前后景或门窗过渡，禁止无因跳切空棚。"
    : "";
  const performance = formatManhuaPerformanceInjectBlock(
    mergeManhuaPerformanceCue(
      {
        dialogueZh: shot.dialogueZh,
        emotionZh: shot.emotionZh,
        voiceToneZh: shot.voiceToneZh,
        microExpressionZh: shot.microExpressionZh,
      },
      action,
    ),
    { stage: "key_art", shotIndex: shot.index },
  );
  const camMove = formatRecommendedCameraMoveLine(`${camera} ${action}`);
  const angleEntry =
    getManhuaCameraAngle(shot.cameraAngleId) ||
    recommendManhuaCameraAngleFromText(`${camera} ${action} ${shot.emotionZh || ""}`);
  const camAngle = formatManhuaCameraAngleLine(angleEntry);
  return [
    `【分镜 ${shot.index}·静帧】`,
    camera ? `运镜（镜头运动，勿与人物动作混写）：${camera}` : "运镜：承接上镜构图做可读微动",
    camAngle,
    camMove,
    framingLock,
    action ? `动作轨迹（主体肢体/身体移位，须有方向与起止）：${action}` : "动作轨迹：落实本镜关键表演",
    sceneShiftHint,
    castLock,
    performance,
    "光线硬锁：必须落实本镜动作描述中的具体光向、冷暖与明暗关系；禁止套用统一的暖背景加轮廓光模板。",
    "必须画出本镜人物、场景与点选道具的配合；服装连续与题材时代一致；禁止空镜或错时代穿戴。",
    "对白硬锁：若动作描述含对白/旁白，只表现为口型、表情与肢体，禁止任何字形出现在画面中。",
    MANHUA_KEYART_NO_TEXT_LOCK,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 写入单镜成片 prompt（兼容旧「一镜一片」）；新路径用 formatWorkbenchSegmentClipInjectBlock */
export function formatWorkbenchClipInjectBlock(shot: ManhuaWorkbenchShot): string {
  const action = String(shot.actionZh || "").trim() || "落实本镜节拍中的关键动作与道具交互";
  const camera = String(shot.cameraZh || "").trim() || "承接首镜构图做可读微动";
  return formatWorkbenchSegmentClipInjectBlock({
    segmentIndex: resolveSegmentIndexFromShotIndex(shot.index),
    durationSec:
      typeof shot.durationSec === "number" && shot.durationSec > 0
        ? shot.durationSec
        : manhuaSegmentDurationSec(MANHUA_FACTORY_DEFAULT_VIDEO_MODEL),
    shots: [shot],
    cameraZh: camera,
    actionZh: action,
  });
}

/** 一段一条成片：时长按模型；动作串联段内静帧 */
export function formatWorkbenchSegmentClipInjectBlock(input: {
  segmentIndex: number;
  durationSec: number;
  shots: ManhuaWorkbenchShot[];
  cameraZh?: string;
  actionZh?: string;
}): string {
  const seg = Math.max(1, Math.floor(input.segmentIndex));
  const dur =
    typeof input.durationSec === "number" && input.durationSec > 0
      ? Math.round(input.durationSec * 10) / 10
      : manhuaSegmentDurationSec(MANHUA_FACTORY_DEFAULT_VIDEO_MODEL);
  const shotLines = input.shots
    .map((s) => {
      const a = String(s.actionZh || "").trim();
      const c = String(s.cameraZh || "").trim();
      return a ? `镜${s.index}${c ? `（${c}）` : ""}：${a}` : "";
    })
    .filter(Boolean)
    .slice(0, MANHUA_KEYARTS_PER_SEGMENT_MAX);
  const action =
    String(input.actionZh || "").trim() ||
    shotLines.join(" → ") ||
    "落实本段节拍中的关键动作与道具交互";
  const camera =
    String(input.cameraZh || "").trim() ||
    String(input.shots[0]?.cameraZh || "").trim() ||
    "承接段内首张静帧构图做可读微动";
  const lead = input.shots[0];
  const performance = formatManhuaPerformanceInjectBlock(
    mergeManhuaPerformanceCue(
      {
        dialogueZh: lead?.dialogueZh,
        emotionZh: lead?.emotionZh,
        voiceToneZh: lead?.voiceToneZh,
        microExpressionZh: lead?.microExpressionZh,
      },
      action,
    ),
    { stage: "clip", shotIndex: seg },
  );
  const camMove = formatRecommendedCameraMoveLine(`${camera} ${action}`);
  const angleEntry =
    getManhuaCameraAngle(lead?.cameraAngleId) ||
    recommendManhuaCameraAngleFromText(`${camera} ${action} ${lead?.emotionZh || ""}`);
  const camAngle = formatManhuaCameraAngleLine(angleEntry);
  const hookLock =
    seg === 1 ? "首段硬锁：前三秒内须出现问题/异常/冲突之一；禁止平淡开场。" : "";
  return [
    `【第 ${seg} 段·成片】`,
    `目标时长：约 ${dur} 秒（允许 ±1 秒）；本段一条成片，勿按单镜短秒裁切。`,
    hookLock,
    shotLines.length ? `段内静帧节拍：\n${shotLines.join("\n")}` : "",
    `动作轨迹（主体肢体/身体移位）：${action}`,
    `运镜（镜头运动，与动作分行执行）：${camera}`,
    camAngle,
    camMove,
    performance,
    MANHUA_CLIP_PREFLIGHT_BLOCK,
    "【参考静帧】成片风格、人物造型、服装与场景请对齐本段参考静帧；以参考图为准做微动演绎。",
    "请落实本段关键动作、道具交互或人物关系变化，避免纯空镜走路。",
    "承接段内静帧人物身份与服装，不新增无关角色；成片画面无新增可读字幕。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 从 keyart / clip 节点 id 或静帧 prompt 解析分镜号（默认 1） */
export function resolveKeyartShotIndex(blockId: string, prompt?: string | null): number {
  const fromId = String(blockId || "").match(/-s(\d{2})(?:-|$)/);
  if (fromId?.[1]) return Math.max(1, parseInt(fromId[1], 10));
  const fromPrompt = String(prompt || "").match(/【分镜\s*(\d+)/);
  if (fromPrompt?.[1]) return Math.max(1, parseInt(fromPrompt[1], 10));
  // 无镜号后缀的本集主 keyart/clip 视为第 1 镜
  if (/^(keyart|clip)-e\d{2}-/i.test(String(blockId || ""))) return 1;
  if (/^(keyart|clip)-[a-z0-9]+$/i.test(String(blockId || ""))) return 1;
  return 1;
}

/** 从 clip id 解析段号：优先 -gSS；旧 -sNN 视为段号；否则由镜号映射 */
export function resolveClipSegmentIndex(blockId: string, prompt?: string | null): number {
  const fromG = String(blockId || "").match(/-g(\d{2})(?:-|$)/i);
  if (fromG?.[1]) return Math.max(1, parseInt(fromG[1], 10));
  const fromPrompt = String(prompt || "").match(/【第\s*(\d+)\s*段/);
  if (fromPrompt?.[1]) return Math.max(1, parseInt(fromPrompt[1], 10));
  // 旧 clip-eXX-sNN：一镜一片时代，sNN ≈ 段号
  const fromS = String(blockId || "").match(/-s(\d{2})(?:-|$)/);
  if (fromS?.[1] && String(blockId || "").startsWith("clip-")) {
    return Math.max(1, parseInt(fromS[1], 10));
  }
  return resolveSegmentIndexFromShotIndex(resolveKeyartShotIndex(blockId, prompt));
}

/** 片段成片：兼容旧调用；新逻辑请用 resolveClipSegmentIndex */
export const resolveClipShotIndex = resolveKeyartShotIndex;

export type WorkbenchShotAssetMount = {
  /** matched=分镜文案点名；default=回落本集全套 */
  mode: "matched" | "default";
  characterIds: string[];
  ancientArchetypeIds: string[];
  propIds: string[];
  expectedCastCount: number;
};

/**
 * 按当前片段文案推断左栏「本片段挂载」：点名角色/道具优先；点不到则回落本集资产。
 */
export function resolveWorkbenchShotAssetMount(input: {
  actionZh?: string | null;
  cameraZh?: string | null;
  keyartPrompt?: string | null;
  characters: Array<{ id: string; nameZh: string }>;
  archetypes?: Array<{ id: string; nameZh: string }>;
  props?: Array<{ id: string; nameZh: string }>;
}): WorkbenchShotAssetMount {
  const hay = [
    String(input.actionZh || ""),
    String(input.cameraZh || ""),
    String(input.keyartPrompt || ""),
  ]
    .join("\n")
    .trim();
  const expectedCastCount = inferWorkbenchShotCastCount(input.actionZh || "");
  const characters = input.characters || [];
  const archetypes = input.archetypes || [];
  const props = input.props || [];

  const hitChar = characters
    .filter((c) => c.nameZh && c.nameZh.length >= 2 && hay.includes(c.nameZh))
    .map((c) => c.id);
  const hitArch = archetypes
    .filter((a) => a.nameZh && a.nameZh.length >= 2 && hay.includes(a.nameZh))
    .map((a) => a.id);
  const hitProp = props
    .filter((p) => p.nameZh && p.nameZh.length >= 2 && hay.includes(p.nameZh))
    .map((p) => p.id);

  // 角色名未点到时，用 女主/男主 等角色词做软匹配（按库序取前 N）
  let softChar = hitChar;
  let softArch = hitArch;
  if (!softChar.length && !softArch.length && hay) {
    const want = Math.max(1, expectedCastCount);
    if (/女主|男主|男女|双人|两人|对视|对峙/.test(hay)) {
      softChar = characters.slice(0, Math.min(want, characters.length)).map((c) => c.id);
      if (softChar.length < want) {
        softArch = archetypes
          .slice(0, Math.min(want - softChar.length, archetypes.length))
          .map((a) => a.id);
      }
    }
  }

  const matched = softChar.length + softArch.length > 0 || hitProp.length > 0;
  if (!matched) {
    return {
      mode: "default",
      characterIds: characters.map((c) => c.id),
      ancientArchetypeIds: archetypes.map((a) => a.id),
      propIds: props.map((p) => p.id),
      expectedCastCount,
    };
  }

  return {
    mode: "matched",
    characterIds: softChar.length ? softChar : characters.map((c) => c.id),
    ancientArchetypeIds: softArch,
    propIds: hitProp.length ? hitProp : props.map((p) => p.id),
    expectedCastCount,
  };
}
