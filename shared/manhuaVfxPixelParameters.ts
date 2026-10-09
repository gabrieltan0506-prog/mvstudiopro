import { z } from "zod";

export const MANHUA_VFX_MIRROR_DEFAULTS = { layers: 5, shrink: .72, drift: .025 };
export const MANHUA_VFX_PAPER_DEFAULTS = { count: 24, size: .055, drift: .18, flutter: 1.4, spread: .8 };
const n = (min: number, max: number) => z.number().finite().min(min).max(max);
export const MANHUA_VFX_ROI_DEFAULTS = { shape: "ellipse" as const, width: .35, height: .65, feather: .12 };
export const MANHUA_VFX_LIQUID_DEFAULTS = { amplitude: .018, frequency: 4, speed: 1.5, reflection: .35 };
export const MANHUA_VFX_GHOST_DEFAULTS = { copies: 3, spacingSec: .08, decay: .65, offsetX: -.035, offsetY: 0 };
export const MANHUA_VFX_WALL_DEFAULTS = { columns: 6, rows: 5, impactSec: .25, contact: { x: .5, y: .5 }, spread: 1.2, gravity: 2, depth: 2 };
export const MANHUA_VFX_BULLET_DEFAULTS = { sceneJobId: "", sceneScopeId: "", clipId: "", freezeSec: 0, startAngleDeg: -45, sweepDeg: 360, radius: 4, height: 1.6, target: [0, 0, 1] as [number, number, number], lensMm: 50 };
export const manhuaVfxRoiSchema = z.object({ shape: z.enum(["ellipse", "rectangle"]), width: n(.01, 1), height: n(.01, 1), feather: n(0, .5) }).strict();
export const manhuaVfxLiquidSchema = z.object({ amplitude: n(0, .08), frequency: n(.5, 12), speed: n(0, 8), reflection: n(0, 1) }).strict();
export const manhuaVfxGhostSchema = z.object({ copies: n(1, 6).int(), spacingSec: n(1 / 60, .2), decay: n(.1, .95), offsetX: n(-.25, .25), offsetY: n(-.25, .25) }).strict();
export const manhuaVfxWallSchema = z.object({ columns: n(2, 10).int(), rows: n(2, 10).int(), impactSec: n(0, 30), contact: z.object({ x: n(0, 1), y: n(0, 1) }).strict(), spread: n(0, 3), gravity: n(0, 6), depth: n(.2, 4) }).strict();
export const manhuaVfxBulletSchema = z.object({ sceneJobId: z.string().regex(/^prv_[a-f0-9]{48}$/), sceneScopeId: z.string().uuid(), clipId: z.string().min(1).max(160), freezeSec: n(0, 30), startAngleDeg: n(-360, 360), sweepDeg: n(-360, 360).refine(value => Math.abs(value) >= 30, "环绕角度至少30度"), radius: n(.5, 30), height: n(-10, 30), target: z.tuple([n(-100, 100), n(-100, 100), n(-100, 100)]), lensMm: n(18, 100) }).strict();

export const MANHUA_VFX_WAVE_DEFAULTS = { angleDeg: 0, reach: .8, radius: .085, rings: 6, trailSec: .28, refraction: .014, glow: .3 };
export const MANHUA_VFX_BLAST_DEFAULTS = { angleDeg: -25, spreadDeg: 55, reach: .8, particles: 72, gravity: 1.2, smoke: .65, ignitionSec: .1 };
export const manhuaVfxWaveSchema = z.object({ angleDeg: n(-360, 360), reach: n(.05, 1.8), radius: n(.02, .22), rings: n(2, 10).int(), trailSec: n(.03, .6), refraction: n(.001, .04), glow: n(0, 1) }).strict();
export const manhuaVfxBlastSchema = z.object({ angleDeg: n(-360, 360), spreadDeg: n(5, 160), reach: n(.05, 2), particles: n(16, 144).int(), gravity: n(0, 6), smoke: n(0, 1), ignitionSec: n(0, 30) }).strict();

export const manhuaVfxMirrorSchema = z.object({ layers: n(2, 8).int(), shrink: n(.45, .85), drift: n(0, .08) }).strict();
export const manhuaVfxPaperSchema = z.object({ count: n(6, 64).int(), size: n(.015, .12), drift: n(0, .6), flutter: n(0, 4), spread: n(.1, 1.5) }).strict();
