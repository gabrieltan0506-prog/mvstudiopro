import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { expect, it } from "vitest";
import { PREVIS_ACTION_PREVIEW_SAMPLES as samples } from "../components/canvas/ManhuaPrevisActionPreview.samples";
import { PREVIS_LIBRARY_ACTIONS } from "./manhuaPrevisActionLibrary";

it("生产脚本或依赖变更后必须重采动作预览，不能悄悄用旧数据", () => {
  for (const [file, hash] of Object.entries(samples.sourceFiles)) {
    expect(
      createHash("sha256")
        .update(readFileSync(path.resolve(file)))
        .digest("hex"),
      `${file} 已变化，请用 scripts/probe-previs-action-preview.py 重采`
    ).toBe(hash);
  }
});
it("动作库每帧都是有限画内端点；待机静止，其他动作有真实差异", () => {
  expect(Object.keys(samples.clips)).toEqual([...PREVIS_LIBRARY_ACTIONS]);
  expect(samples.fps).toBe(24);
  expect(samples.durationSec).toBe(2);
  for (const [kind, clip] of Object.entries(samples.clips)) {
    expect(clip.frames).toHaveLength(48);
    expect(clip.bones.length).toBeGreaterThan(10);
    for (const frame of clip.frames) {
      expect(frame).toHaveLength(clip.bones.length);
      for (const bone of frame) {
        expect(bone).toHaveLength(4);
        bone.forEach((value, i) => {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThan(i % 2 ? 180 : 320);
        });
      }
    }
    const unique = new Set(clip.frames.map(f => JSON.stringify(f)));
    if (kind === "idle") expect(unique.size).toBe(1);
    else expect(unique.size).toBeGreaterThan(1);
  }
});
