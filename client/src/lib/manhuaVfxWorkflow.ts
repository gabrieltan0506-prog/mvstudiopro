import { MANHUA_VFX_CITY_DEFAULTS } from "@shared/manhuaVfxCityFold";
import { MANHUA_VFX_PROP_DEFAULTS, MANHUA_VFX_WORLD_DEFAULTS, isManhuaVfxPropKind } from "@shared/manhuaVfxPropFracture";
import { MANHUA_VFX_MIRROR_DEFAULTS, MANHUA_VFX_PAPER_DEFAULTS, MANHUA_VFX_WAVE_DEFAULTS, MANHUA_VFX_BLAST_DEFAULTS, MANHUA_VFX_ROI_DEFAULTS, MANHUA_VFX_LIQUID_DEFAULTS, MANHUA_VFX_GHOST_DEFAULTS, MANHUA_VFX_WALL_DEFAULTS, MANHUA_VFX_BULLET_DEFAULTS } from "@shared/manhuaVfxPixelParameters";
import { MANHUA_VFX_RAIN_DEFAULTS } from "@shared/manhuaVfx";
import { manhuaVfxCompositionSchema, type ManhuaVfxComposition, type ManhuaVfxEffect, type ManhuaVfxState } from "@shared/manhuaVfx";
import type { ClipOption, TrackedJob } from "./postProdWorkshop";
import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex, isManhuaFactoryArtifactBlock } from "./canvasDramaStudio";

/** Only current episode/project factory outputs and attached, persisted image assets. */
export function manhuaVfxImageOptions(blocks: CanvasBlock[], episodeIndex: number): ClipOption[] {
  const options: ClipOption[] = [];
  const seen = new Set<string>();
  const add = (id: string, raw: string | undefined, label: string) => {
    const url = manhuaVfxMediaIdentity((raw || "").trim());
    if (!/^gs:\/\/[^/]+\/.+/.test(url) || seen.has(url)) return;
    seen.add(url); options.push({ id, url, label });
  };
  for (const block of blocks) {
    if (block.archivedFromPreviousScript || !isManhuaFactoryArtifactBlock(block)) continue;
    const episode = getBlockEpisodeIndex(block);
    if (episode != null && episode !== episodeIndex) continue;
    if (block.kind === "image") add(block.id, block.outputUrl, `当前图片 · ${block.id}`);
    for (const asset of block.uploadedAssets || []) {
      if (asset.kind === "image") add(`${block.id}:${asset.id}`, asset.gcsUri || asset.url, asset.fileName || "已上传图片");
    }
  }
  return options;
}

/** Signed GCS read links identify the same immutable object; arbitrary URL queries may identify different media. */
export function manhuaVfxMediaIdentity(raw: string): string {
  if (raw.startsWith("gs://")) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname === "storage.googleapis.com") return `gs://${decodeURIComponent(url.pathname.slice(1))}`;
    if (url.hostname.endsWith(".storage.googleapis.com")) return `gs://${url.hostname.slice(0, -".storage.googleapis.com".length)}${decodeURIComponent(url.pathname)}`;
  } catch { /* Invalid sources are rejected by the submit boundary. */ }
  return raw;
}

export function manhuaVfxSourceKey(clip: Pick<ClipOption, "id" | "url">): string {
  return JSON.stringify([clip.id, manhuaVfxMediaIdentity(clip.url)]);
}

export function sameManhuaVfxComposition(a: unknown, b: unknown): boolean {
  const left = manhuaVfxCompositionSchema.safeParse(a);
  const right = manhuaVfxCompositionSchema.safeParse(b);
  return left.success && right.success && JSON.stringify(left.data) === JSON.stringify(right.data);
}

export function makeManhuaVfxEffect(kind: ManhuaVfxEffect["kind"], id: string): ManhuaVfxEffect {
  return {
    id, kind, startSec: 0, durationSec: isManhuaVfxPropKind(kind) || kind === "city_fold" || kind === "prop_scene" ? 3 : 1,
    color: kind === "city_fold" ? "#C8B396" : isManhuaVfxPropKind(kind) || kind === "prop_scene" ? "#F3E8D4" : kind === "floating_paper" ? "#FFF5DF" : kind === "digital_rain" ? "#35FF82" : ["impact_burst", "directed_blast"].includes(kind) ? "#FFB35C" : "#67E8F9", scale: ["digital_rain", "liquid_mirror", "motion_ghost", "wall_fracture", "bullet_time", "bullet_wave", "directed_blast", "mirror_corridor", "floating_paper", "city_fold", "prop_scene"].includes(kind) ? 1 : kind === "fruit_stall_fracture" ? .65 : kind === "cup_fracture" ? .45 : kind === "shield" ? 0.4 : 0.25, intensity: 1,
    ...(kind === "city_fold" ? { city: { ...MANHUA_VFX_CITY_DEFAULTS } } : {}),
    ...(kind === "prop_scene" ? { world: { ...MANHUA_VFX_WORLD_DEFAULTS, position: [...MANHUA_VFX_WORLD_DEFAULTS.position] as [number, number, number] } } : {}),
    ...(isManhuaVfxPropKind(kind) || kind === "prop_scene" ? { prop: { ...MANHUA_VFX_PROP_DEFAULTS, staggerSec: kind === "cup_fracture" ? 0 : MANHUA_VFX_PROP_DEFAULTS.staggerSec } } : {}),
    ...(kind === "mirror_corridor" ? { mirror: { ...MANHUA_VFX_MIRROR_DEFAULTS }, roi: { shape: "rectangle" as const, width: .8, height: .85, feather: .025 } } : {}),
    ...(kind === "floating_paper" ? { paper: { ...MANHUA_VFX_PAPER_DEFAULTS } } : {}),
    ...(kind === "bullet_wave" ? { wave: { ...MANHUA_VFX_WAVE_DEFAULTS } } : {}),
    ...(kind === "directed_blast" ? { blast: { ...MANHUA_VFX_BLAST_DEFAULTS } } : {}),
    ...(kind === "digital_rain" ? { rain: { ...MANHUA_VFX_RAIN_DEFAULTS } } : {}),
    ...(["liquid_mirror", "motion_ghost"].includes(kind) ? { roi: { ...MANHUA_VFX_ROI_DEFAULTS } } : {}),
    ...(kind === "liquid_mirror" ? { liquid: { ...MANHUA_VFX_LIQUID_DEFAULTS } } : {}),
    ...(kind === "motion_ghost" ? { ghost: { ...MANHUA_VFX_GHOST_DEFAULTS } } : {}),
    ...(kind === "wall_fracture" ? { wall: { ...MANHUA_VFX_WALL_DEFAULTS, contact: { ...MANHUA_VFX_WALL_DEFAULTS.contact } } } : {}),
    ...(kind === "bullet_time" ? { bullet: { ...MANHUA_VFX_BULLET_DEFAULTS } } : {}),
    anchor: { space: "screen", position: [kind === "bullet_wave" ? .15 : .5, 0.5] },
  };
}

export function parseManhuaVfxTrajectory(text: string): Array<{ timeSec: number; x: number; y: number }> | undefined {
  if (!text.trim()) return undefined;
  return text.trim().split(/\n/).map((line, index) => {
    const cells = line.trim().split(/[,，\s]+/).filter(Boolean);
    const [timeSec, x, y] = cells.map(Number);
    if (cells.length !== 3 || ![timeSec, x, y].every(Number.isFinite)) throw new Error(`轨迹第 ${index + 1} 行须填写：秒数、横向位置、纵向位置`);
    return { timeSec, x, y };
  });
}

export function validateManhuaVfxDuration(composition: ManhuaVfxComposition, durationSec: number): string | undefined {
  if (!(Number.isFinite(durationSec) && durationSec > 0)) return "请先等待原片读取时长";
  const outside = composition.effects.find(effect => effect.startSec + effect.durationSec > durationSec + 1e-9 || effect.anchor.trajectory?.some(point => point.timeSec > durationSec + 1e-9));
  return outside ? "特效结束时间超过原片时长，请调整时间区间" : undefined;
}

export function canAdoptManhuaVfxRequest(state: ManhuaVfxState, requestId: string, clips: ClipOption[]): boolean {
  const request = state.requests[requestId];
  const draft = state.draft;
  const source = draft && clips.find(clip => clip.id === draft.sourceId);
  return Boolean(request && draft && source && request.status === "succeeded" && request.output?.gcsUri &&
    request.output.requestId === requestId && request.output.sourceKey === request.sourceKey &&
    request.sourceId === draft.sourceId && request.sourceKey === draft.sourceKey &&
    manhuaVfxSourceKey(source) === request.sourceKey &&
    sameManhuaVfxComposition(request.composition, request.output.composition) &&
    sameManhuaVfxComposition(request.composition, draft.composition));
}

/** Effects enter downstream tools only after explicit adoption; source replacement invalidates adoption. */
export function adoptedManhuaVfxClipOptions(state: ManhuaVfxState | undefined, scopeKey: string, clips: ClipOption[]): ClipOption[] {
  if (!state || state.scopeKey !== scopeKey || !state.adoptedRequestId) return [];
  const request = state.requests[state.adoptedRequestId];
  const source = request && clips.find(clip => clip.id === request.sourceId);
  if (!request || !source || request.status !== "succeeded" || !request.output?.gcsUri ||
      request.output.sourceKey !== request.sourceKey || request.output.requestId !== request.requestId ||
      manhuaVfxSourceKey(source) !== request.sourceKey || !sameManhuaVfxComposition(request.output.composition, request.composition)) return [];
  return [{ id: `post-prod:${request.jobId || request.requestId}`, url: request.output.gcsUri, label: `已采用特效 · ${source.label}` }];
}

/** Restore saved pending tasks independently of the server's latest-job display window. */
export function pendingManhuaVfxTrackedJobs(state: ManhuaVfxState | undefined, scopeKey: string, knownJobs: TrackedJob[]): TrackedJob[] {
  if (!state || state.scopeKey !== scopeKey) return [];
  return Object.values(state.requests).flatMap(request => request.jobId &&
    ["queued", "running"].includes(request.status) && !knownJobs.some(job => job.jobId === request.jobId)
    ? [{ jobId: request.jobId, action: "manhua_vfx", label: "漫剧特效候选", scopeKey,
        status: request.status as "queued" | "running", createdAt: request.createdAt }]
    : []);
}

export type ManhuaVfxVideoRect = { left: number; top: number; width: number; height: number };
/** object-fit:contain places pixels inside the element; letterboxing is not part of source coordinates. */
export function manhuaVfxContainedVideoRect(box: { width: number; height: number }, video: { width: number; height: number }): ManhuaVfxVideoRect | undefined {
  if (![box.width, box.height, video.width, video.height].every(value => Number.isFinite(value) && value > 0)) return undefined;
  const ratio = Math.min(box.width / video.width, box.height / video.height);
  const width = video.width * ratio;
  const height = video.height * ratio;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

export function manhuaVfxPositionFromPointer(rect: ManhuaVfxVideoRect | undefined, pointer: { x: number; y: number }): [number, number] | undefined {
  if (!rect || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y) || pointer.x < rect.left || pointer.y < rect.top || pointer.x > rect.left + rect.width || pointer.y > rect.top + rect.height) return undefined;
  return [Number(((pointer.x - rect.left) / rect.width).toFixed(5)), Number(((pointer.y - rect.top) / rect.height).toFixed(5))];
}

export function upsertManhuaVfxTrajectoryPoint(points: Array<{ timeSec: number; x: number; y: number }>, point: { timeSec: number; x: number; y: number }): Array<{ timeSec: number; x: number; y: number }> {
  if (!Number.isFinite(point.timeSec) || point.timeSec < 0 || point.timeSec > 30 || ![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("轨迹点须位于原片秒窗和画面内");
  const timeSec = Number(point.timeSec.toFixed(3));
  const next = points.filter(existing => existing.timeSec !== timeSec);
  if (next.length >= 120) throw new Error("轨迹已有120个时刻，请先调整已有点");
  return [...next, { ...point, timeSec }].sort((a, b) => a.timeSec - b.timeSec);
}

/** Same linear screen interpolation as the fixed Blender renderer, for the position guide only. */
export function manhuaVfxPositionAtTime(effect: ManhuaVfxEffect, timeSec: number): [number, number] {
  if (effect.prop && Number.isFinite(timeSec)) {
    const { holdStartSec, holdDurationSec } = effect.prop, age = timeSec - effect.startSec;
    timeSec = effect.startSec + (age < holdStartSec ? age : age < holdStartSec + holdDurationSec ? holdStartSec : age - holdDurationSec);
  }
  const points = effect.anchor.trajectory;
  if (!points?.length || !Number.isFinite(timeSec) || points.some((point, index) =>
    ![point.timeSec, point.x, point.y].every(Number.isFinite) || point.timeSec < 0 || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || (index > 0 && point.timeSec <= points[index - 1].timeSec))) return effect.anchor.position;
  if (timeSec <= points[0].timeSec) return [points[0].x, points[0].y];
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1], right = points[index];
    if (timeSec <= right.timeSec) {
      const ratio = (timeSec - left.timeSec) / (right.timeSec - left.timeSec);
      return [left.x * (1 - ratio) + right.x * ratio, left.y * (1 - ratio) + right.y * ratio];
    }
  }
  return [points[points.length - 1].x, points[points.length - 1].y];
}

/** 仅列出当前作品/集、未归档且已有成功预演回执的真实三维场景。 */
export function manhuaVfxSceneOptions(blocks: CanvasBlock[], episodeIndex: number) {
  return blocks.filter(block => !block.archivedFromPreviousScript && isManhuaFactoryArtifactBlock(block) && getBlockEpisodeIndex(block) === episodeIndex).flatMap(block => (block.previsStudio?.history || []).filter(row => /^prv_[a-f0-9]{48}$/.test(row.jobId)).map((row, index) => ({ jobId: row.jobId, scopeId: row.sourceScopeId ?? block.previsStudio!.scopeId, clipId: block.id, label: `${block.id} · 三维版本${index + 1}`, durationSec: row.durationSec, spec: row.spec })));
}
