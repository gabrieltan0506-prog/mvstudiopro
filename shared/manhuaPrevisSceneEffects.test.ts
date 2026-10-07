import { expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "./manhuaPrevis";
import { previsPresentationGuideSpec } from "./manhuaPrevisPlayback";
import type { PrevisSceneEffect } from "./manhuaPrevisSceneEffects";
it("validates source actors, full effect windows, duplicate/conflicting effects and retimed guidance", () => {
 const spec = createManhuaPrevisStudio(4).spec, actorId = spec.actors[0].id;
 const explode: PrevisSceneEffect = { id: "parts", actorId, kind: "explode", distance: .5, startSec: 1, durationSec: 1 };
 spec.sceneEffects = [explode];
 expect(manhuaPrevisSpecSchema.parse(spec).sceneEffects).toEqual([explode]);
 for (const bad of [ { ...explode, actorId: "absent" }, { ...explode, durationSec: 4 } ])
   expect(manhuaPrevisSpecSchema.safeParse({ ...spec, sceneEffects: [bad] }).success).toBe(false);
 expect(manhuaPrevisSpecSchema.safeParse({ ...spec, sceneEffects: [explode, { ...explode, id: "other" }] }).success).toBe(false);
 const cape: PrevisSceneEffect = { id: "cape", actorId, kind: "cape", width: .8, length: 1, color: "#FF0000", wind: [0,1,0] };
 expect(manhuaPrevisSpecSchema.safeParse({ ...spec, sceneEffects: [explode, cape] }).success).toBe(false);
 const label: PrevisSceneEffect = { id: "label", actorId, kind: "label", bone: "head", text: "角色", color: "#FFFFFF", offset: [.5,0,.2], fontSize: .1 };
 expect(manhuaPrevisSpecSchema.safeParse({ ...spec, sceneEffects: [label] }).success).toBe(true);
 expect(manhuaPrevisSpecSchema.safeParse({ ...spec, sceneEffects: [{ ...label, text: "bad\nline" }] }).success).toBe(false);
 spec.timeMap = { sourceDurationSec: 4, spans: [{ sourceStartSec: 0, sourceEndSec: 4, rate: 2 }] };
 expect(previsPresentationGuideSpec(spec).sceneEffects).toEqual([{ ...explode, startSec: .5, durationSec: .5 }]);
});
