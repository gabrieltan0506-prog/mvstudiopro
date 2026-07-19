/**
 * 剧本工作台：从工厂节点文本推导「片段内多镜」列表（先可读可测，再接批量静帧）。
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

/** 从节拍 / 反推正文拆出多镜；失败则回落为 4 镜骨架（合计约 15s） */
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

  const unique = Array.from(new Set(numbered)).slice(0, 8);
  if (unique.length < 2) return defaultWorkbenchShots(text.slice(0, 180));

  const durations = splitDurations(15, unique.length);
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
  const durations = splitDurations(15, actions.length);
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
