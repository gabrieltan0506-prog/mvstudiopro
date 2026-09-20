import type { ManhuaPrevisSpec } from "@shared/manhuaPrevis";
export type Vec3 = [number, number, number];
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const u = clamp(x); return u * u * (3 - 2 * u); };
const mix = (a: number[], b: number[], t: number): Vec3 => a.map((v, i) => v + (b[i] - v) * t) as Vec3;
/** 仅投影平面根位置；姿态、水中高度及碰撞以正式渲染为准。 */
export function previsLayoutActorPosition(actor: ManhuaPrevisSpec["actors"][number], time: number): Vec3 {
  const route = actor.motionRoute;
  if (route?.length) {
    if (time <= route[0].timeSec) return [...route[0].position, 0];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (time <= b.timeSec) return mix([...a.position, 0], [...b.position, 0], smooth((time - a.timeSec) / (b.timeSec - a.timeSec)));
    }
    return [...route[route.length - 1].position, 0];
  }
  return mix([...actor.start, 0], [...actor.end, 0], clamp((time - actor.moveStartSec) / Math.max(1 / 24, actor.moveEndSec - actor.moveStartSec)));
}
/** 对齐生产脚本24fps取帧和相机平滑插值。 */
export function previsLayoutCamera(spec: ManhuaPrevisSpec, time: number) {
  const frame = Math.min(spec.durationSec * 24, Math.floor(Math.max(0, time) * 24) + 1);
  const shot = spec.cameras.find(c => frame >= Math.round(c.startSec * 24) + 1 && frame <= Math.round(c.endSec * 24)) ?? spec.cameras[spec.cameras.length - 1];
  if (!shot) return null;
  const begin = Math.round(shot.startSec * 24) + 1, end = Math.round(shot.endSec * 24);
  const u = smooth((frame - begin) / Math.max(1, end - begin));
  let position = mix(shot.position, shot.endPosition ?? shot.position, u);
  const target = mix(shot.target, shot.endTarget ?? shot.target, u);
  if (shot.orbitDeg != null) {
    const a = shot.orbitDeg * Math.PI / 180 * u, x = shot.position[0] - shot.target[0], y = shot.position[1] - shot.target[1];
    position = [shot.target[0] + x * Math.cos(a) - y * Math.sin(a), shot.target[1] + x * Math.sin(a) + y * Math.cos(a), shot.position[2]];
  }
  return { position, target, lensMm: shot.lens };
}
export function movePrevisLayoutEndpoint(spec: ManhuaPrevisSpec, id: string, endpoint: "start" | "end", point: [number, number]): ManhuaPrevisSpec {
  const position = point.map(v => Math.round(Math.max(-12, Math.min(12, v)) * 10) / 10) as [number, number];
  return { ...spec, actors: spec.actors.map(actor => {
    if (actor.id !== id) return actor;
    return { ...actor, [endpoint]: position, ...(actor.motionRoute ? { motionRoute: actor.motionRoute.map((node, i, nodes) =>
      i === (endpoint === "start" ? 0 : nodes.length - 1) ? { ...node, position } : node) } : {}) };
  }) };
}
export function projectPrevisPoint(point: Vec3, camera: NonNullable<ReturnType<typeof previsLayoutCamera>>, width: number, height: number) {
  const sub = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v - b[i]) as Vec3;
  const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) as Vec3; };
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot = (a: Vec3, b: Vec3) => a.reduce((n, v, i) => n + v*b[i], 0);
  const forward = norm(sub(camera.target, camera.position));
  const right = norm(cross(forward, Math.abs(forward[2]) > .999 ? [0, 1, 0] : [0, 0, 1]));
  const up = cross(right, forward), relative = sub(point, camera.position), depth = dot(relative, forward);
  if (depth <= .1) return null;
  const focal = width * camera.lensMm / 36;
  return { x: width / 2 + dot(relative, right) * focal / depth, y: height / 2 - dot(relative, up) * focal / depth, depth };
}
