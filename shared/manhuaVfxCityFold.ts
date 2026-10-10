import { z } from "zod";

const n = (min: number, max: number) => z.number().finite().min(min).max(max);
export const MANHUA_VFX_CITY_DEFAULTS = { blocks: 4, foldDeg: 90, foldStartSec: .25, foldEndSec: 2.6, streetWidth: 6, buildingHeight: 10, lensMm: 28 };
export const manhuaVfxCitySchema = z.object({
  blocks: n(2, 6).int(), foldDeg: n(30, 150), foldStartSec: n(0, 30), foldEndSec: n(0, 30),
  streetWidth: n(4, 12), buildingHeight: n(5, 20), lensMm: n(24, 65),
}).strict();
export const isManhuaVfxSceneKind = (kind: string) => kind === "bullet_time" || kind === "city_fold" || kind === "prop_scene";
