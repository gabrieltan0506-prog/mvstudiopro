import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  manhuaPrevisSpecSchema,
  manhuaPrevisStudioSchema,
  createManhuaPrevisStudio,
  formatPrevisMotionGuide,
  previsSpecKey,
} from "../../shared/manhuaPrevis";
import { compilePrevisScriptDraft } from "../../shared/manhuaPrevisScript";
import { validatePrevisReport } from "./manhuaPrevisReport";
// 只消费真实本地场景回执；未提供目录则明确跳过，不提交新任务。
describe.skipIf(!process.env.PREVIS_WATER_EVIDENCE)(
  "真实出水报告与恢复",
  () => {
    const load = () => {
      const dir = process.env.PREVIS_WATER_EVIDENCE!;
      return {
        spec: manhuaPrevisSpecSchema.parse(
          JSON.parse(readFileSync(path.join(dir, "spec.json"), "utf8"))
        ),
        report: JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")),
      };
    };
    it("120帧完整保留，草稿和指南保留同一水轨", () => {
      const { spec, report } = load();
      expect(validatePrevisReport(report, spec)).toEqual(report);
      const studio = createManhuaPrevisStudio(5);
      studio.spec = spec;
      expect(
        manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio))).spec
      ).toEqual(spec);
      expect(formatPrevisMotionGuide(spec)).toContain("破水");
      const old = structuredClone(spec);
      delete old.waterEmergence;
      expect(previsSpecKey(old)).not.toBe(previsSpecKey(spec));
      const draft = compilePrevisScriptDraft({
        currentSpec: spec,
        shots: [{ index: 1, durationSec: 5, actionZh: "角色1站立。" }],
        characters: [],
      });
      expect(draft.spec).toBeNull();
      expect(draft.errors.join("")).toContain("出水");
    });
    it.each([
      "missing",
      "truncate",
      "duplicate",
      "cross",
      "root",
      "active",
      "range",
      "screen",
      "hidden-overlap",
      "shrunk-range",
    ])("拒收%s篡改", mode => {
      const { spec, report } = load();
      const w = report.waterEmergence;
      if (mode === "missing") delete report.waterEmergence;
      if (mode === "truncate") w.events[0].samples.pop();
      if (mode === "duplicate") w.events[1] = w.events[0];
      if (mode === "cross") w.events[0].crossFrame++;
      if (mode === "root") w.events[0].samples[24].root[2] += 0.1;
      if (mode === "active") w.events[0].samples[24].active = false;
      if (mode === "range") w.events[0].samples[24].worldBounds = null;
      if (mode === "screen") w.events[0].samples[24].screenBounds.max[0] = 1.2;
      if (mode === "shrunk-range") {
        const row = w.events[0].samples[24];
        row.worldBounds = {
          min: [spec.actors[0].start[0] - 1e-8, -1e-8, 1e-8],
          max: [spec.actors[0].start[0] + 1e-8, 1e-8, 2e-8],
        };
      }
      if (mode === "hidden-overlap")
        w.events[1].samples[48].screenBounds = structuredClone(
          w.events[0].samples[48].screenBounds
        );
      expect(() => validatePrevisReport(report, spec)).toThrow();
    });
  }
);
