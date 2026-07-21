/**
 * Map creative-advisor (sidecar) plan export → workbench shots / writer-pack fields.
 */

import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";
import { MANHUA_SINGLE_CLIP_DURATION_SEC } from "./manhuaScriptWorkbench.js";

export type ManhuaAdvisorExportedShot = {
  index?: number;
  durationSec?: number;
  cameraZh?: string;
  actionZh?: string;
  dialogueZh?: string | null;
  emotionZh?: string | null;
  voiceToneZh?: string | null;
  microExpressionZh?: string | null;
  visualDesc?: string;
  audioDesc?: string;
};

export type ManhuaAdvisorPlanExport = {
  story?: string;
  script?: string;
  characters?: unknown;
  shots?: ManhuaAdvisorExportedShot[];
  storyboards?: unknown[];
  workingDir?: string;
};

export type ManhuaWorkbenchSyncPayload = {
  storyText: string;
  scriptText: string;
  charactersSummary: string;
  shots: ManhuaWorkbenchShot[];
  /** Markdown-ish beats block for workbench / factory reverse input */
  beatsMarkdown: string;
};

function asNonEmpty(value: unknown): string {
  return String(value ?? "").trim();
}

function summarizeCharacters(characters: unknown): string {
  if (!characters) return "";
  if (typeof characters === "string") return characters.trim().slice(0, 4000);
  try {
    return JSON.stringify(characters, null, 2).slice(0, 4000);
  } catch {
    return "";
  }
}

export function mapAdvisorShotsToWorkbench(
  rawShots: ManhuaAdvisorExportedShot[] | undefined | null,
): ManhuaWorkbenchShot[] {
  if (!Array.isArray(rawShots) || rawShots.length === 0) return [];
  const out: ManhuaWorkbenchShot[] = [];
  for (let i = 0; i < rawShots.length; i++) {
    const s = rawShots[i];
    if (!s) continue;
    const parsed = Number(s.index);
    // Export is 1-based; tolerate 0 from upstream brief idx.
    const index =
      Number.isFinite(parsed) && parsed >= 1
        ? Math.floor(parsed)
        : Number.isFinite(parsed) && parsed === 0
          ? 1
          : i + 1;
    const actionZh = asNonEmpty(s.actionZh) || asNonEmpty(s.visualDesc);
    if (!actionZh) continue;
    out.push({
      index,
      durationSec: Math.max(
        3,
        Math.min(20, Number(s.durationSec) || MANHUA_SINGLE_CLIP_DURATION_SEC),
      ),
      cameraZh: asNonEmpty(s.cameraZh) || "中景，平视",
      actionZh,
      dialogueZh: asNonEmpty(s.dialogueZh) || undefined,
      emotionZh: asNonEmpty(s.emotionZh) || undefined,
      voiceToneZh: asNonEmpty(s.voiceToneZh) || undefined,
      microExpressionZh: asNonEmpty(s.microExpressionZh) || undefined,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function formatAdvisorShotsAsBeatsMarkdown(shots: ManhuaWorkbenchShot[]): string {
  if (!shots.length) return "";
  const lines = [
    "## 分镜表",
    "",
    "| 镜号 | 景别/运镜 | 内容 | 台词 | 情绪 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const s of shots) {
    lines.push(
      `| ${s.index} | ${s.cameraZh || ""} | ${s.actionZh || ""} | ${s.dialogueZh || ""} | ${s.emotionZh || ""} |`,
    );
  }
  return lines.join("\n");
}

export function mapAdvisorPlanToWorkbenchSync(
  plan: ManhuaAdvisorPlanExport | null | undefined,
): ManhuaWorkbenchSyncPayload | null {
  if (!plan) return null;
  const shots = mapAdvisorShotsToWorkbench(plan.shots);
  const storyText = asNonEmpty(plan.story);
  const scriptText = asNonEmpty(plan.script);
  if (!shots.length && !storyText && !scriptText) return null;
  return {
    storyText,
    scriptText,
    charactersSummary: summarizeCharacters(plan.characters),
    shots,
    beatsMarkdown: formatAdvisorShotsAsBeatsMarkdown(shots),
  };
}
