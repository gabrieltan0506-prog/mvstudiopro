/**
 * 剧本工作台：从工厂节点文本推导「片段内多镜」列表，供批量静帧与成片对齐。
 */

export type ManhuaWorkbenchShot = {
  index: number;
  durationSec: number;
  cameraZh: string;
  actionZh: string;
};

const DEFAULT_CAMERAS = [
  "全景，平视，缓慢推近",
  "中景，固定机位，三分构图",
  "中近景，轻微横移",
  "特写，平视，微推",
];

export const MANHUA_SINGLE_CLIP_DURATION_SEC = 10;

/** 从节拍 / 反推正文拆出多镜；失败则回落为 4 镜骨架（单次合计 10s） */
export function parseWorkbenchShotsFromText(raw: string | undefined | null): ManhuaWorkbenchShot[] {
  const text = String(raw || "").trim();
  if (!text) return defaultWorkbenchShots();

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const numbered: string[] = [];
  for (const line of lines) {
    const m = line.match(
      /^(?:[-*•]\s*)?(?:分镜|镜头|节拍|Shot|SHOT)?\s*(\d{1,2})\s*[:：、.\)\]】]\s*(.+)$/i,
    );
    if (m?.[2]) {
      numbered.push(m[2].trim());
      continue;
    }
    const m2 = line.match(/^(\d{1,2})\s*[:：、.\)\]】]\s*(.+)$/);
    if (m2?.[2] && m2[2].length > 6) {
      numbered.push(m2[2].trim());
    }
  }

  const unique = Array.from(new Set(numbered)).slice(0, MANHUA_SHOT_KEYART_MAX);
  if (unique.length < 2) return defaultWorkbenchShots(text.slice(0, 180));

  const durations = splitDurations(MANHUA_SINGLE_CLIP_DURATION_SEC, unique.length);
  return unique.map((actionZh, i) => ({
    index: i + 1,
    durationSec: durations[i]!,
    cameraZh: DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
    actionZh: actionZh.slice(0, 220),
  }));
}

export function defaultWorkbenchShots(seedAction?: string): ManhuaWorkbenchShot[] {
  const base = String(seedAction || "").trim();
  const actions = base
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
  const durations = splitDurations(MANHUA_SINGLE_CLIP_DURATION_SEC, actions.length);
  return actions.map((actionZh, i) => ({
    index: i + 1,
    durationSec: durations[i]!,
    cameraZh: DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
    actionZh,
  }));
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

export function workbenchShotTotalSec(shots: ManhuaWorkbenchShot[]): number {
  return Math.round(shots.reduce((s, x) => s + x.durationSec, 0) * 10) / 10;
}

/** 写入静帧 prompt：本镜场面必须带场景/道具/服装配合 */
export function formatWorkbenchShotInjectBlock(shot: ManhuaWorkbenchShot): string {
  const camera = String(shot.cameraZh || "");
  const framingLock = /全景/.test(camera)
    ? "景别硬锁：全景；人物必须全身入画，并清楚展示环境纵深与人物空间关系，禁止裁到腰部或大腿。"
    : /中近景/.test(camera)
      ? "景别硬锁：中近景；主体以胸部以上为主，保留动作方向，禁止退回普通半身中景。"
      : /特写/.test(camera)
        ? "景别硬锁：特写；面部表情或关键道具必须占画面主体，禁止生成半身或全身中景。"
        : /中景/.test(camera)
          ? "景别硬锁：中景；人物动作与关系清楚可读；若指定三分构图，主体必须落在三分线交点，禁止中心对称海报构图。"
          : "";
  return [
    `【分镜 ${shot.index}·静帧】`,
    `运镜：${shot.cameraZh}`,
    framingLock,
    `动作场面：${shot.actionZh}`,
    "光线硬锁：必须落实本镜动作描述中的具体光向、冷暖与明暗关系；禁止套用统一的暖背景加轮廓光模板。",
    "必须画出本镜人物、场景与点选道具的配合；服装连续与题材时代一致；禁止空镜或错时代穿戴。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 从 keyart 节点 id / prompt 解析分镜号（默认 1） */
export function resolveKeyartShotIndex(blockId: string, prompt?: string | null): number {
  const fromId = String(blockId || "").match(/-s(\d{2})(?:-|$)/);
  if (fromId?.[1]) return Math.max(1, parseInt(fromId[1], 10));
  const fromPrompt = String(prompt || "").match(/【分镜\s*(\d+)/);
  if (fromPrompt?.[1]) return Math.max(1, parseInt(fromPrompt[1], 10));
  return 1;
}

/** 成片前按镜静帧上限（成本与编排平衡） */
export const MANHUA_SHOT_KEYART_MAX = 4;
