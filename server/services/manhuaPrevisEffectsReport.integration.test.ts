import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  manhuaPrevisSpecSchema,
  manhuaPrevisDraftSchema,
} from "../../shared/manhuaPrevis";
import { validatePrevisReport } from "./manhuaPrevisReport";
describe.skipIf(!process.env.PREVIS_EFFECTS_EVIDENCE)(
  "实际爆点和烟团报告",
  () => {
    const load = () => {
      const d = process.env.PREVIS_EFFECTS_EVIDENCE!;
      return {
        spec: manhuaPrevisSpecSchema.parse(
          JSON.parse(readFileSync(path.join(d, "spec.json"), "utf8"))
        ),
        report: JSON.parse(readFileSync(path.join(d, "report.json"), "utf8")),
      };
    };
    it("完整实际回执保留，草稿允许清空数值", () => {
      const { spec, report } = load();
      expect(validatePrevisReport(report, spec)).toEqual(report);
      expect(report.effects).toHaveLength(2);
      const draft = structuredClone(spec);
      draft.effects![0].radius = 0;
      expect(manhuaPrevisDraftSchema.parse(draft).effects![0].radius).toBe(0);
      expect(manhuaPrevisSpecSchema.safeParse(draft).success).toBe(false);
    });
    it.each([
      "missing",
      "truncate",
      "frame",
      "identity",
      "center",
      "size",
      "light",
      "light-position",
      "visible",
    ])("拒收%s特效回执", mode => {
      const { spec, report } = load();
      if (mode === "missing") delete report.effects;
      else {
        const e = report.effects[0],
          s = e.samples[12];
        if (mode === "truncate") e.samples.pop();
        if (mode === "frame") s.frame++;
        if (mode === "identity") e.id = "wrong";
        if (mode === "center") s.center[0]++;
        if (mode === "size") s.scale[0] = 0;
        if (mode === "light") s.lightEnergy = 0;
        if (mode === "light-position") s.lightPosition[0]++;
        if (mode === "visible") s.visible = false;
      }
      expect(() => validatePrevisReport(report, spec)).toThrow();
    });
  }
);
