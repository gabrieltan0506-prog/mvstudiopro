/**
 * 高定執行矩陣 · 共用算術引擎（Cam6）
 * - 前後端、HTML/PDF 與 DOM overlay 共用同一套「鏡行 + 30 字多一格」規則。
 * - 無文案時回退 6 格（與既有產品預設一致）。
 */

export type StoryboardPanelStats = {
  /** 含「镜」或「Shot」的非空行數（至少為 1） */
  explicitCount: number;
  /** 送進 prompt / UI / PDF 疊加的總畫格數（已含長行 +1） */
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

/** DOM / PDF：與 PlatformPage 一致；≤4 → 2 欄，≤6 → 3 欄，否則 4 欄 */
export function getGridDimensions(panelCount: number): { cols: number; rows: number } {
  const n = Math.max(1, Math.min(panelCount, MAX_PANELS));
  const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function estimateStoryboardPanelCount(scriptContext: string): number {
  return analyzeStoryboardPanelStats(scriptContext).overlayPanelCount;
}
