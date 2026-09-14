import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { compilePrevisScriptDraft } from "../../shared/manhuaPrevisScript";
import { validatePrevisReport } from "./manhuaPrevisReport";
describe.skipIf(!process.env.PREVIS_ROUTE_EVIDENCE)(
  "实际路线与双事件报告",
  () => {
    const load = () => {
      const d = process.env.PREVIS_ROUTE_EVIDENCE!;
      return {
        spec: manhuaPrevisSpecSchema.parse(
          JSON.parse(readFileSync(path.join(d, "spec.json"), "utf8"))
        ),
        report: JSON.parse(readFileSync(path.join(d, "report.json"), "utf8")),
      };
    };
    it("保留完整帧，接力角色与路线进入同一报告", () => {
      const { spec, report } = load();
      expect(validatePrevisReport(report, spec)).toEqual(report);
      expect(report.motionRoutes[0].samples.length).toBe(192);
      expect(report.interactions).toHaveLength(2);
      const d = compilePrevisScriptDraft({
        currentSpec: spec,
        shots: [{ index: 1, durationSec: 8, actionZh: "主角格挡" }],
        characters: [],
      });
      expect(d.spec).toBeNull();
      expect(d.errors.join("")).toContain("分段运动轨");
    });
    it.each(["missing", "frame", "truncate", "identity", "root", "yaw"])(
      "拒收%s路线回执",
      mode => {
        const { spec, report } = load();
        if (mode === "missing") delete report.motionRoutes;
        else {
          const row = report.motionRoutes[0];
          if (mode === "frame") row.samples[1].frame = 1;
          if (mode === "truncate") row.samples.pop();
          if (mode === "identity") row.actorId = "不存在";
          if (mode === "root") row.samples[80].root[0] += 0.2;
          if (mode === "yaw") row.samples[80].facingDeg += 90;
        }
        expect(() => validatePrevisReport(report, spec)).toThrow();
      }
    );
  }
);
