import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { validatePrevisReport } from "./manhuaPrevisReport";
// 只读取本机真实Blender回执，未配置时明确跳过，不调用任何生产服务。
describe.skipIf(!process.env.PREVIS_SWORD_EVIDENCE)(
  "真实持剑回执与生产恢复门禁",
  () => {
    const load = () => {
      const dir = process.env.PREVIS_SWORD_EVIDENCE!;
      return {
        spec: manhuaPrevisSpecSchema.parse(
          JSON.parse(readFileSync(path.join(dir, "spec.json"), "utf8"))
        ),
        report: JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")),
      };
    };
    it("完整逐帧JSON原样保留并接受", () => {
      const { spec, report } = load();
      expect(validatePrevisReport(report, spec)).toEqual(report);
    });
    it.each([
      "missing",
      "truncate",
      "duplicate",
      "wrong-frame",
      "fake-contact",
      "wrong-length",
    ])("拒绝%s证据", mode => {
      const { spec, report } = load();
      if (mode === "missing") delete report.weapons;
      if (mode === "truncate") report.weapons[0].samples.pop();
      if (mode === "duplicate") report.weapons[1] = report.weapons[0];
      if (mode === "wrong-frame") report.weapons[0].samples[2].frame = 1;
      if (mode === "fake-contact")
        report.weapons[0].samples[48].contactPoint[0] += 0.1;
      if (mode === "wrong-length")
        report.weapons[0].samples[0].bladeTip[0] += 2;
      expect(() => validatePrevisReport(report, spec)).toThrow();
    });
  }
);
