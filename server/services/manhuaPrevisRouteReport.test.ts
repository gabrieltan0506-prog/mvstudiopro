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
