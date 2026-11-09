import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { submitVideoGrade } from "./videoGradeSubmit";
import { capManhuaMediaHistory } from "@shared/manhuaMediaHistoryCap";
import { canvasMusicMvFinalGradeSchema } from "@shared/canvasMusicMv";

/** 从真实组件源码取同名表达式（useCallback 取回调本体），在受控上下文里执行，不起浏览器。 */
function production(file: string) {
  const source = readFileSync(new URL(`../components/canvas/${file}.tsx`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = new Map<string, string>();
  function walk(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      expressions.set(n.name.text, ts.isCallExpression(init) && init.expression.getText(tree) === "useCallback" ? init.arguments[0].getText(tree) : init.getText(tree));
    }
    ts.forEachChild(n, walk);
  }
  walk(tree);
  const run = (name: string, context: Record<string, unknown>) =>
    runInNewContext(ts.transpileModule(`(${expressions.get(name)!})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  return { source, run };
}
const free = production("FreeformCanvas"), mv = production("CanvasMusicMvStudio");
const original = "https://video.test/original.mp4";
const upscaled = "https://d2h7xmz5gqybh9.cloudfront.net/up/4k.mp4";
const graded = "https://video.test/graded.mp4";
const grade = { all: { lutId: "golden_hour_subtle", saturation: 1.1 } };
const probe = vi.fn(async (url: string) => ({ sourceUrl: url, width: 1280, height: 720, durationSec: 12, durationExactSec: 12.04, fps: 24, sourceResolution: "720p" }));
const importSource = vi.fn(async () => "gs://user-bucket/imported/4k.mp4");
const realSubmit = (input: Parameters<typeof submitVideoGrade>[0], deps: Parameters<typeof submitVideoGrade>[1]) =>
  submitVideoGrade(input, { ...deps, probe, importSource });

it("两处入口按钮都在：自由画布紧挨高清放大、MV 第 6 步在超分区块内并提示先调色再超分", () => {
  const upscaleBtn = free.source.indexOf('"高清放大（2K / 4K）"');
  const gradeBtn = free.source.indexOf("data-canvas-grade-entry");
  expect(upscaleBtn).toBeGreaterThan(0);
  expect(gradeBtn).toBeGreaterThan(upscaleBtn);
  expect(gradeBtn - upscaleBtn).toBeLessThan(6000);
  expect(free.source).toContain("<VideoGradePanel");
  const block = mv.source.indexOf("data-mv-final-upscale");
  const gradeArea = mv.source.indexOf("data-mv-final-grade");
  expect(gradeArea).toBeGreaterThan(block);
  expect(mv.source.slice(gradeArea, gradeArea + 2000)).toContain("建议先调色再超分");
  expect(mv.source).toContain("<VideoGradePanel");
});

function freeContext(block: Record<string, unknown>) {
  const queue = vi.fn(async (_input: unknown) => ({ jobId: "grade-job" }));
  const patchOne = vi.fn();
  return {
    queue, patchOne,
    context: {
      blocks: [block], blocksRef: { current: [block] }, gradeBusyId: null, patchOne,
      queuePostProd: { mutateAsync: queue },
      fetchPostProdJob: vi.fn(async () => ({ status: "succeeded", output: { url: graded } })),
      submitVideoGrade: realSubmit, capManhuaMediaHistory, maskMediaProviderDetails: (m: string) => m,
      toast: { error: vi.fn(), success: vi.fn() }, setGradeBusyId: vi.fn(), setGradePanelBlockId: vi.fn(),
      setTimeout, Promise, Array, String, Boolean, Error,
    },
  };
}

it("自由画布调色：单片 concat、grade 原样透传、新版本写 outputUrls 且原片保留", async () => {
  const block = { id: "v1", kind: "video", outputUrl: original, outputUrls: [original] };
  const f = freeContext(block);
  await free.run("startGradeForBlock", f.context)("v1", grade, false);
  expect(f.queue).toHaveBeenCalledTimes(1);
  const input = f.queue.mock.calls[0][0] as { action: string; params: { clips: string[]; grade: unknown; width: number; height: number; fps: number; transition?: unknown; trims?: unknown } };
  expect(input.action).toBe("concat");
  expect(input.params.clips).toEqual([original]);
  expect(input.params.grade).toEqual(grade);
  expect(input.params).not.toHaveProperty("transition");
  expect(input.params).not.toHaveProperty("trims");
  expect(input.params).toMatchObject({ width: 1280, height: 720, fps: 24 });
  const [id, patch] = f.patchOne.mock.calls[0];
  expect(id).toBe("v1");
  expect(patch.outputUrl).toBe(graded);
  expect(patch.outputUrls[0]).toBe(graded);
  expect(patch.outputUrls).toContain(original);
  expect(block.outputUrl).toBe(original);
});

it("自由画布高清版调色：CloudFront 先导入再提交，原片与高清字段不动", async () => {
  importSource.mockClear();
  const block = { id: "v2", kind: "video", outputUrl: original, upscaledVideoUrl: upscaled };
  const f = freeContext(block);
  await free.run("startGradeForBlock", f.context)("v2", grade, true);
  expect(importSource).toHaveBeenCalledWith(upscaled);
  const input = f.queue.mock.calls[0][0] as { params: { clips: string[]; grade: unknown } };
  expect(input.params.clips).toEqual(["gs://user-bucket/imported/4k.mp4"]);
  expect(input.params.grade).toEqual(grade);
  const patch = f.patchOne.mock.calls[0][1];
  expect(patch.outputUrls).toContain(original);
  expect(patch).not.toHaveProperty("upscaledVideoUrl");
});

it("自由画布无调色参数不提交", async () => {
  const f = freeContext({ id: "v3", kind: "video", outputUrl: original });
  await free.run("startGradeForBlock", f.context)("v3", undefined, false);
  expect(f.queue).not.toHaveBeenCalled();
  expect(f.patchOne).not.toHaveBeenCalled();
});

it("MV 成片调色：记录 finalGrades（schema 合法）、单片 grade 透传、成片块不改", async () => {
  const finalBlock = { id: "mvfinal-1", kind: "video", outputUrl: original };
  const latest = { current: { finalBlockId: "mvfinal-1", finalGrades: [] as unknown[] } };
  const patch = vi.fn((delta: Record<string, unknown>) => { latest.current = { ...latest.current, ...delta }; });
  const queue = vi.fn(async (_input: unknown) => ({ jobId: "mv-grade-job" }));
  const context: Record<string, unknown> = {
    latest, patch, perform: (work: () => Promise<void>) => work(), getBlocks: () => [finalBlock], block: { id: "mv-studio" },
    queuePostProd: { mutateAsync: queue }, submitVideoGrade: realSubmit, setGradeOpen: vi.fn(), setProgress: vi.fn(),
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, Error,
  };
  context.patchGrade = mv.run("patchGrade", context);
  await mv.run("gradeFinal", context)(grade);
  const input = queue.mock.calls[0][0] as { action: string; params: { clips: string[]; grade: unknown } };
  expect(input.action).toBe("concat");
  expect(input.params.clips).toEqual([original]);
  expect(input.params.grade).toEqual(grade);
  const [record] = latest.current.finalGrades as Array<Record<string, unknown>>;
  expect(record).toMatchObject({ finalBlockId: "mvfinal-1", sourceUrl: original, grade, status: "queued", jobId: "mv-grade-job" });
  expect(canvasMusicMvFinalGradeSchema.safeParse(record).success).toBe(true);
  expect(finalBlock.outputUrl).toBe(original);
});
