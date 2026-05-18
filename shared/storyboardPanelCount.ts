/**
 * 高定执行矩阵 · 共用算术引擎（Cam6）
 * - 前后端、HTML/PDF 与 DOM overlay 共用同一套「镜行 + 30 字多一格」规则。
 * - 无文案时回退 6 格（与既有产品预设一致）。
 */

export type StoryboardPanelStats = {
  /** 含「镜」或「Shot」的非空行数（至少为 1） */
  explicitCount: number;
  /** 送进 prompt / UI / PDF 叠加的总画格数（已含长行 +1） */
  overlayPanelCount: number;
};

const MAX_PANELS = 16;

export function analyzeStoryboardPanelStats(scriptContext: string): StoryboardPanelStats {
  const s = String(scriptContext ?? "").trim();
  if (!s) {
    return { explicitCount: 6, overlayPanelCount: 6 };
  }

  const shotLines = s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/镜/.test(line) || /shot/i.test(line)) return true;
      if (/^\d{1,2}[\.、:：]\s+\S/.test(line)) return true;
      if (/第\s*\d{1,2}\s*镜/.test(line)) return true;
      return false;
    });

  const explicitCount = Math.max(1, shotLines.length);

  let calculatedPanels = 0;
  for (const line of shotLines) {
    calculatedPanels += 1;
    if (line.length > 30) calculatedPanels += 1;
  }

  const rawPanels = calculatedPanels > 0 ? calculatedPanels : 6;
  const overlayPanelCount = Math.min(Math.max(rawPanels, 1), MAX_PANELS);
  const explicitCapped = Math.min(explicitCount, MAX_PANELS);

  return { explicitCount: explicitCapped, overlayPanelCount };
}

/** DOM / PDF：与 PlatformPage 一致；≤4 → 2 栏，≤6 → 3 栏，否则 4 栏 */
export function getGridDimensions(panelCount: number): { cols: number; rows: number } {
  const n = Math.max(1, Math.min(panelCount, MAX_PANELS));
  const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function estimateStoryboardPanelCount(scriptContext: string): number {
  return analyzeStoryboardPanelStats(scriptContext).overlayPanelCount;
}
