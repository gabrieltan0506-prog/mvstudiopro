/**
 * 画布节点重跑前重编译提示词（不复用节点里存的旧 prompt）。
 */

import {
  planManhuaAssetImageSpawns,
  seedIdFromManhuaSheetBlockId,
  type ManhuaAssetImageGateInput,
} from "./manhuaAssetImageGate.js";

export type ManhuaRerunBlockSlice = {
  id: string;
  prompt?: string;
  outputUrl?: string;
  outputUrls?: string[];
  episodeIndex?: number;
  status?: string;
  error?: string;
};

export type ManhuaRerunCompileResult = {
  prompt: string;
  beforePrompt: string;
  afterPrompt: string;
  stashOutputUrls: string[];
  changed: boolean;
};

const ASSET_SHEET_RE = /^(charsheet|sceneplate|propsheet|propplate)-/i;
const CLIP_RE = /^clip-/i;
const KEYART_RE = /^keyart-/i;

export function isManhuaAssetSheetBlockId(blockId: string): boolean {
  return ASSET_SHEET_RE.test(String(blockId || ""));
}

export function isManhuaClipBlockId(blockId: string): boolean {
  return CLIP_RE.test(String(blockId || ""));
}

export function isManhuaKeyartBlockId(blockId: string): boolean {
  return KEYART_RE.test(String(blockId || ""));
}

/** 设定图 + 段成片必须重编译；关键静帧请走工作台重出（ensure 不刷新 keyart prompt） */
export function shouldRecompileManhuaBlockOnRerun(blockId: string): boolean {
  return isManhuaAssetSheetBlockId(blockId) || isManhuaClipBlockId(blockId);
}

export function collectManhuaBlockOutputStash(block: {
  outputUrl?: string;
  outputUrls?: string[];
}): string[] {
  const out: string[] = [];
  const push = (u?: string) => {
    const t = String(u || "").trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };
  push(block.outputUrl);
  for (const u of block.outputUrls || []) push(u);
  return out.slice(0, 8);
}

/**
 * 设定图重编译：只认 plan.id === block.id，禁止 seed 回退把全身稿套到大头照。
 */
export function compileManhuaAssetSheetPromptForRerun(
  block: ManhuaRerunBlockSlice,
  gateInput: ManhuaAssetImageGateInput,
  opts?: { regenerateNoteZh?: string },
): ManhuaRerunCompileResult | null {
  if (!isManhuaAssetSheetBlockId(block.id)) return null;
  const seedId = seedIdFromManhuaSheetBlockId(block.id);
  if (!seedId) return null;
  const plans = planManhuaAssetImageSpawns(
    {
      ...gateInput,
      episodeIndex: gateInput.episodeIndex || block.episodeIndex || 1,
      assetBlocks: gateInput.assetBlocks,
    },
    {
      forceEpisodeSheets: true,
      regenerateAnchorIds: [seedId],
      regenerateNoteZh: opts?.regenerateNoteZh,
    },
  );
  const plan = plans.find((p) => p.id === block.id);
  if (!plan?.prompt?.trim()) return null;
  const beforePrompt = String(block.prompt || "");
  const afterPrompt = plan.prompt.trim();
  return {
    prompt: afterPrompt,
    beforePrompt,
    afterPrompt,
    stashOutputUrls: collectManhuaBlockOutputStash(block),
    changed: beforePrompt.trim() !== afterPrompt,
  };
}

export function applyManhuaRerunCompilePatch(
  compiled: ManhuaRerunCompileResult,
): {
  prompt: string;
  outputUrl: undefined;
  outputUrls: string[];
  status: "idle";
  error: undefined;
} {
  return {
    prompt: compiled.prompt,
    outputUrl: undefined,
    outputUrls: compiled.stashOutputUrls,
    status: "idle",
    error: undefined,
  };
}
