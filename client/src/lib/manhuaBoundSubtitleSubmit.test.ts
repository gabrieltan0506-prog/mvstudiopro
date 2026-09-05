import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { buildManhuaSubtitleBurnSrt } from "@shared/manhuaEditSubtitle";
import { normalizeManhuaRenderedSubtitle, type ManhuaRenderedSubtitle } from "@shared/manhuaRenderedSubtitle";
import { beginManhuaFinalSubtitleBurn, findManhuaFinalVideoVersionIdentity, replaceManhuaFinalAssembleVersion } from "@shared/manhuaFinalPostProd";
import { beginManhuaSubtitleSubmit, finishManhuaSubtitleSubmit, createManhuaSubtitleTaskGate } from "./manhuaSubtitleTaskGate";

const source = ts.createSourceFile("OmniCanvas.tsx", readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callbackText = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleBurnSubtitle" && node.initializer && ts.isCallExpression(node.initializer)) callbackText = node.initializer.arguments[0]!.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!callbackText) throw new Error("未找到真实烧字按钮回调");
const compiled = ts.transpileModule(`const callback = ${callbackText};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const timeline: ManhuaRenderedSubtitle = { version: 1, textSource: "assembly_script_snapshot", timing: "rendered_shot_windows", durationSec: 8,
  cues: [{ shotIndex: 1, order: 1, startSec: 0, endSec: 8, textZh: "旧片原对白" }] };
function setup(hasTimeline = true) {
  const url = "https://test.invalid/old.mp4";
  let block = replaceManhuaFinalAssembleVersion({ id: "final-e01" }, { url, jobId: "assemble-job", subtitleTimeline: hasTimeline ? timeline : undefined });
  const queue = vi.fn(async () => ({ jobId: "burn-job" }));
  const toast = { message: vi.fn(), error: vi.fn() };
  const gate = { current: createManhuaSubtitleTaskGate() };
  const deps = { beginManhuaSubtitleSubmit, finishManhuaSubtitleSubmit, burnSubtitleTaskGateRef: gate,
    syncBurnSubtitleBusy: vi.fn(), finalAssembleVideoUrl: url, finalAssembleBlock: block,
    writerFocusEpisode: 1, toast, normalizeManhuaRenderedSubtitle, findManhuaFinalVideoVersionIdentity,
    buildManhuaSubtitleBurnSrt, queueBurnSubtitleMutation: { mutateAsync: queue }, beginManhuaFinalSubtitleBurn,
    updateFinalBlock: (_id: string, update: (value: typeof block) => typeof block) => { block = update(block); },
    pollBurnSubtitleTask: vi.fn(async () => {}), toManhuaSubtitlePublicError: (error: Error) => error.message };
  const callback = new Function(...Object.keys(deps), `${compiled}\nreturn callback;`)(...Object.values(deps)) as (srt: string) => Promise<void>;
  return { callback, queue, toast, gate, getBlock: () => block };
}

describe("真实按钮只消费选中成片字幕", () => {
  it("新稿字幕或缺回执旧片都在请求前拒绝并释放提交锁", async () => {
    for (const state of [setup(true), setup(false)]) {
      await state.callback("新稿当前计划字幕");
      expect(state.queue).not.toHaveBeenCalled();
      expect(state.toast.error).toHaveBeenCalledOnce();
      expect(beginManhuaSubtitleSubmit(state.gate.current).acquired).toBe(true);
    }
  });
  it("提交的是旧版实际8秒SRT，绑定原视频/新任务，不替换旧媒体", async () => {
    const state = setup();
    const srt = buildManhuaSubtitleBurnSrt(timeline.cues);
    await state.callback(srt);
    expect(state.queue).toHaveBeenCalledWith({ action: "burn_subtitle", params: { videoUri: "https://test.invalid/old.mp4", subtitleSrt: srt } });
    expect(srt).toContain("00:00:08,000");
    expect(state.getBlock().outputUrl).toBe("https://test.invalid/old.mp4");
    expect(state.getBlock().manhuaFinalPostProd?.jobId).toBe("burn-job");
  });
});
