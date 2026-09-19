import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { queuedManhuaClipBlocks, resolveShotsForEpisodeKeyarts, ensureManhuaFragmentClips, resolveManhuaFragmentRunTargets } from "./canvasDramaStudio";
import { groupShotsIntoSegments, resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import { buildManhuaAutoSegmentBinding } from "@shared/manhuaAutoSegment";
import { createCanvasAudioCue, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";

// 执行工作台原始派生表达式，不在测试中重新实现其排序/选择逻辑。
const source = readFileSync(new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url), "utf8");
function derived(name: string, scope: Record<string, unknown>) {
  const tree = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer?.getText(tree) || "";
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!expression) throw new Error(`生产派生缺失：${name}`);
  return runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
}

it.each([false, true])("同段两份媒体和音轨：倒序=%s，当前编辑对象必须等于提交目标", reversed => {
  const keyart = { ...defaultCanvasBlock("image", 0, 0), id: "keyart-e01-s01-probe", episodeIndex: 1, prompt: "第1镜，推门", outputUrl: "https://test.invalid/still.png" };
  const model = "seedance-2.5";
  const reverse = { ...defaultCanvasBlock("text", 0, 0), id: "reverse-e01-probe", episodeIndex: 1, outputText: Array.from({ length: 18 }, (_, i) => `${i + 1}. 第 ${i + 1} 镜：推门后观察房间`).join("\n") };
  const segments = groupShotsIntoSegments(resolveShotsForEpisodeKeyarts([reverse, keyart], 1), { videoModel: model });
  expect(segments.length).toBeGreaterThan(1);
  const segment = segments[0]!;
  const binding = buildManhuaAutoSegmentBinding(1, segment, model);
  const clips = ["a", "z"].map(label => ({ ...defaultCanvasBlock("video", 0, 0), id: `clip-e01-g01-auto-${label}`, episodeIndex: 1, videoModel: model as "seedance-2.5", prompt: "【第1段·10s】推门", outputUrl: `https://test.invalid/${label}.mp4`, manhuaAutoSegment: binding, audioStudio: { ...emptyCanvasAudioStudio(), cues: [{ ...createCanvasAudioCue("dialogue", `voice-${label}`), textZh: `声音${label}` }] } }));
  const other = { ...clips[0]!, id: "clip-e01-g02-auto-other", manhuaAutoSegment: buildManhuaAutoSegmentBinding(1, segments[1]!, model), outputUrl: "https://test.invalid/other.mp4" };
  const blocks = [reverse, ...Array.from({ length: 18 }, (_, i) => ({ ...keyart, id: `keyart-e01-s${String(i + 1).padStart(2, "0")}-probe` })), ...(reversed ? [...clips].reverse() : clips), other];
  const episodeClips = derived("episodeClips", { blocks, focusEpisode: 1, videoModel: model, queuedManhuaClipBlocks, resolveClipLocalSegmentIndex, useMemo: (f: () => unknown) => f() });
  const activeClip = derived("activeClip", { episodeClips, focusEpisode: 1, activeSegNo: 1, resolveClipLocalSegmentIndex });
  // 生产面板把activeClip同时交给媒体预览、音轨block/onChange与onGenerateFragment.clipId。
  expect(activeClip.outputUrl).toBe("https://test.invalid/a.mp4");
  expect(activeClip.audioStudio.cues[0].id).toBe("voice-a");
  // Omni父级只传段号；runManhuaFactoryPipeline真实顺序：ensure → resolve targets。
  const prepared = ensureManhuaFragmentClips(blocks, [], 1, { videoModel: model });
  const target = resolveManhuaFragmentRunTargets(prepared.blocks, 1, 1);
  console.log("同段选择探针", { reversed, previewAndAudioId: activeClip.id, submitId: target.clipId, archivedIds: prepared.blocks.filter(b => b.archivedFromPreviousScript).map(b => b.id) });
  expect(target.clipId).toBe(activeClip.id);
  for (const original of [...clips, other]) {
    const kept = prepared.blocks.find(b => b.id === original.id)!;
    expect(kept.outputUrl).toBe(original.outputUrl);
    expect(kept.audioStudio).toEqual(original.audioStudio);
  }
  expect(prepared.blocks.find(b => b.id === other.id)?.archivedFromPreviousScript).not.toBe(true);
  expect(resolveManhuaFragmentRunTargets(prepared.blocks, 1, 2).clipId).toBe(other.id);
  expect(prepared.blocks.find(b => b.id === clips[1]!.id)?.archivedFromPreviousScript).toBe(true);
});
