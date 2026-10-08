import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { validateRouteReport } from "./manhuaPrevisRouteReport";

describe("放下后乘员实际轨迹", () => {
  const fixture = () => {
    const spec = createManhuaPrevisStudio(4).spec;
    const actor = spec.actors[0];
    actor.id = "mother";
    actor.motionRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: 2, position: [0, 0], facingDeg: 0 },
      { timeSec: 95 / 24, position: [2, 0], facingDeg: 90 },
    ];
    spec.actors = [actor];
    spec.piggyback = { carrierId: "girl", passengerId: actor.id, setDown: { startSec: 1, groundSec: 1.75, releaseSec: 2, endSec: 2.25 } };
    const rows = [{ actorId: actor.id, samples: Array.from({ length: 96 }, (_, i) => ({ frame: i + 1, root: [0, 0, 0] as [number, number, number], facingDeg: 0 })) }];
    return { spec, rows };
  };
  it("承载者离开时乘员留在放下位置", () => {
    const { spec, rows } = fixture();
    expect(() => validateRouteReport(rows, spec)).not.toThrow();
  });
  it("拒绝放下后继续跟随或转身的乘员回执", () => {
    for (const kind of ["position", "facing"]) {
      const { spec, rows } = fixture();
      if (kind === "position") rows[0].samples[95].root[0] = 2;
      else rows[0].samples[95].facingDeg = 90;
      expect(() => validateRouteReport(rows, spec)).toThrow("实际站位或转身");
    }
  });
  it("旧版无放下事件仍按整条路线严格核验", () => {
    const { spec, rows } = fixture();
    delete spec.piggyback!.setDown;
    expect(() => validateRouteReport(rows, spec)).toThrow("实际站位或转身");
  });
});

describe("带骨路线报告来源", () => {
  const fixture = () => {
    const spec = createManhuaPrevisStudio(2).spec;
    const actor = spec.actors[0];
    actor.motionRoute = [
      { timeSec: 0, position: [0, 0], facingDeg: 0 },
      { timeSec: 47 / 24, position: [0, 0], facingDeg: 0 },
    ];
    actor.riggedModel = { sourceJobId: "m3d_test", forwardAxis: "+X", targetHeight: 1.7 };
    spec.actors = [actor];
    const rows: Parameters<typeof validateRouteReport>[0] = [{
      actorId: actor.id,
      rootSource: { kind: "riggedModel", sourceJobId: "m3d_test", sha256: "a".repeat(64) },
      samples: Array.from({ length: 48 }, (_, i) => ({ frame: i + 1, root: [0, 0, 0], facingDeg: 0 })),
    }];
    const models = [{ actorId: actor.id, sourceJobId: "m3d_test", sha256: "a".repeat(64) }];
    return { spec, rows, models };
  };
  it("相同任务和模型摘要的真实根报告通过", () => {
    const { spec, rows, models } = fixture();
    expect(() => validateRouteReport(rows, spec, models)).not.toThrow();
  });
  it.each(["missing", "sourceRig", "job", "sha", "noModel", "duplicate"])("拒绝%s来源", kind => {
    const { spec, rows, models } = fixture();
    if (kind === "missing") delete rows[0].rootSource;
    if (kind === "sourceRig") rows[0].rootSource = { kind: "sourceRig" };
    if (kind === "job") models[0].sourceJobId = "other";
    if (kind === "sha") models[0].sha256 = "b".repeat(64);
    if (kind === "noModel") models.length = 0;
    if (kind === "duplicate") models.push(models[0]);
    expect(() => validateRouteReport(rows, spec, models)).toThrow("同一真实模型根");
  });
  it("白模不能携带带骨来源标记", () => {
    const { spec, rows, models } = fixture();
    delete spec.actors[0].riggedModel;
    expect(() => validateRouteReport(rows, spec, models)).toThrow("来源类型不一致");
  });
});
