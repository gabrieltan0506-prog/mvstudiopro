import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { movePrevisLayoutEndpoint, previsLayoutActorPosition, previsLayoutCamera, projectPrevisPoint } from "./manhuaPrevisLayout";
describe("白模布局与生产规格", () => {
  it("修改端点同时更新运动轨迹，不改另一端或原配置", () => {
    const spec = createManhuaPrevisStudio(2).spec;
    const a = spec.actors[0];
    a.motionRoute = [{ timeSec: 0, position: a.start, facingDeg: 0 }, {timeSec: 47/24, position: a.end, facingDeg: 0}];
    const updated = movePrevisLayoutEndpoint(spec, a.id, "end", [5.16, -15]);
    expect(updated.actors[0].end).toEqual([5.2,-12]);
    expect(updated.actors[0].motionRoute?.[1].position).toEqual([5.2,-12]);
    expect(updated.actors[0].start).toEqual(a.start);
    expect(a.end).not.toEqual([5.2,-12]);
    expect(previsLayoutActorPosition(updated.actors[0], 47/24)).toEqual([5.2,-12,0]);
  });
  it("空机位草稿不崩溃，不虚构默认机位",()=>{ const spec=createManhuaPrevisStudio(2).spec;spec.cameras=[];expect(previsLayoutCamera(spec,0)).toBeNull(); });
  it("相机首尾帧与环绕半径正确，画后点不投影", () => {
    const spec = createManhuaPrevisStudio(2).spec;
    spec.cameras = [{startSec:0,endSec:2,position:[0,-8,3],target:[0,0,1],orbitDeg:90,lens:35}];
    expect(previsLayoutCamera(spec, 0)!.position).toEqual([0,-8,3]);
    const last = previsLayoutCamera(spec,47/24)!;
    expect(last.position[0]).toBeCloseTo(8);
    expect(last.position[1]).toBeCloseTo(0);
    expect(projectPrevisPoint([0,0,1],last,480,270)).toMatchObject({x:240,y:135});
    expect(projectPrevisPoint([20,0,7],last,480,270)).toBeNull();
  });
});
