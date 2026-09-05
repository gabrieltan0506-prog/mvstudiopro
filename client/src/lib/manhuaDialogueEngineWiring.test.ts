import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workbench = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);
const omni = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("./canvasDramaStudio.ts", import.meta.url), "utf8");

describe("漫剧对白与引擎选择真实接线", () => {
  it("工作台优先显示顶部当前选型，而不是旧 clip 盖章", () => {
    expect(workbench).toContain("videoModel?: string | null");
    expect(workbench).toContain('String(videoModel || "").trim()');
    expect(omni).toContain("videoModel={activePilotVideoModel}");
  });

  it("对白覆盖同时写回 writerPack 与画布生产节点", () => {
    expect(omni).toContain("setWriterPack((prev)");
    expect(omni).toContain("patchShotDialogueSection(episode.body || \"\", dialogues)");
    expect(omni).toContain("patchShotDialogueSection(base, dialogues)");
    expect(studio).toMatch(
      /applyShotDialoguesFromText\(\s*withReverseDialogues,\s*beatsText\s*\)/,
    );
  });

  it("单段、整集、试片和续跑向 pipeline 传同一 ensure 上下文", () => {
    expect(omni).toContain("const ensureOptions = {");
    expect(omni).toContain("segmentPlan: episodeSegmentPlan.segments.length");
    expect(omni).toContain("ensureOptions,");
    expect(studio).toContain("ensureOptions?: ManhuaFragmentClipEnsureOptions");
  });

  it("人工只编辑独立补充区，系统主体仍可安全重编译", () => {
    expect(workbench).toContain("extractManhuaClipUserSupplement(promptText)");
    expect(workbench).toContain("upsertManhuaClipUserSupplement(promptText, next)");
    expect(studio).toContain("const generationBase = clearManhuaVideoEditOperation(existing)");
    expect(studio).toContain("mergeManhuaDerivedClipPrompt(segPrompt, generationBase.prompt)");
  });
});
