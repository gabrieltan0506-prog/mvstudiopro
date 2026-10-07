import { expect, it } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { validatePrevisSceneEffectsReport } from "./manhuaPrevisSceneEffectsReport";
it("requires full baked cape evidence and rejects shifted frame, bad attachment or dropped geometry", () => {
 const spec = createManhuaPrevisStudio(2).spec;
 spec.sceneEffects = [{ id: "cape", kind: "cape", actorId: spec.actors[0].id, width: .8, length: 1, color: "#FF0000", wind: [0,1,0] }];
 const report = [{ id: "cape", kind: "cape", actorId: spec.actors[0].id, boundaryZh: "真实布料开发证据", samples: Array.from({ length: 48 }, (_, i) => ({ frame: i+1, targetMeshes: ["cape"], meshVertices: 425, finiteBounds: true, minimum: [0,0,0], maximum: [1,1,2], pinError: 0, bakedPlayback: true, bakedShapeKeyCount: 49, collisionMeshes: 2, closedCollisionMeshes: 2, estimatedInsideVertices: 0, estimatedPenetration: 0 })) }];
 expect(() => validatePrevisSceneEffectsReport(report, spec)).not.toThrow();
 for (const mode of ["frame", "truncated", "pin", "unbaked", "geometry"]) {
   const bad = structuredClone(report);
   if (mode === "frame") bad[0].samples[6].frame = 1;
   if (mode === "truncated") bad[0].samples.pop();
   if (mode === "pin") bad[0].samples[6].pinError = .1;
   if (mode === "unbaked") bad[0].samples[6].bakedPlayback = false;
   if (mode === "geometry") bad[0].samples[6].meshVertices = 0;
   expect(() => validatePrevisSceneEffectsReport(bad, spec)).toThrow();
 }
});
