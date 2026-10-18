import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { manhuaVfxStateSchema } from "@shared/manhuaVfx";
import { manhuaVfxMediaIdentity } from "./manhuaVfxWorkflow";

export const digitalHumanVfxKey = (scope: string) =>
  `digitalHuman.vfx.v1.${scope}`;
export function readDigitalHumanVfx(
  data: Record<string, string>,
  scope: string
) {
  const raw = data[digitalHumanVfxKey(scope)];
  if (!raw) return undefined;
  const state = manhuaVfxStateSchema.parse(JSON.parse(raw));
  if (state.scopeKey !== scope)
    throw new Error("特效方案属于另一段，未覆盖或采用");
  return state;
}
export function digitalHumanPostProdMedia(draft: DigitalHumanDraft) {
  return {
    story: draft.script,
    clips: [
      ...draft.videos.flatMap((v, i) =>
        v.status === "succeeded" && v.source
          ? [
              {
                id: v.requestId,
                url: v.source,
                label: `口播原片 · 版本${i + 1}`,
              },
              ...[
                ...(v.upscaleHistory || []),
                ...(v.upscale ? [v.upscale] : []),
              ].flatMap(u =>
                u.status === "succeeded" && u.source
                  ? [
                      {
                        id:
                          u === v.upscale
                            ? `${v.requestId}:upscale`
                            : `${v.requestId}:upscale:${u.taskId || manhuaVfxMediaIdentity(u.source)}`,
                        url: u.source,
                        label: `高清原片 · 版本${i + 1}`,
                      },
                    ]
                  : []
              ),
            ]
          : []
      ),
      ...draft.productions.flatMap((p, i) =>
        p.status === "succeeded" &&
        p.source &&
        p.request.input.action === "digital_human_final"
          ? [
              {
                id: p.request.requestId,
                url: p.source,
                label: `完整原声混音成片 · 版本${i + 1}`,
              },
            ]
          : []
      ),
    ],
    audio: [
      ...draft.mix.tracks.map((t, i) => ({
        id: `track:${draft.id}:${i}`,
        url: t.source,
        label: t.name,
      })),
      ...draft.audios.flatMap(a =>
        a.status === "succeeded" && a.source
          ? [
              {
                id: a.request.billingRequestId,
                url: a.source,
                label: a.fileName || "已生成口播",
              },
            ]
          : []
      ),
    ],
  };
}
export function digitalHumanVfxAssets(drafts: DigitalHumanDraft[]) {
  const images = drafts.flatMap(d =>
    [
      d.portrait,
      d.scene,
      ...d.originalPortraits,
      ...d.actors.map(a => a.portrait),
      ...(d.keyframes?.map(k => k.media) || []),
    ].flatMap((m, i) =>
      m?.source && manhuaVfxMediaIdentity(m.source).startsWith("gs://")
        ? [
            {
              id: `${d.id}:image:${manhuaVfxMediaIdentity(m.source)}`,
              url: manhuaVfxMediaIdentity(m.source),
              label: m.name || "已保存图片",
            },
          ]
        : []
    )
  );
  const scenes = drafts.flatMap(d =>
    (d.previsStudio?.history || [])
      .filter(r => /^prv_[a-f0-9]{48}$/.test(r.jobId))
      .map((r, i) => ({
        jobId: r.jobId,
        scopeId: r.sourceScopeId ?? d.previsStudio!.scopeId,
        clipId: `dh-previs-${d.id}`,
        label: `三维预演 · ${d.id.slice(0, 6)} · 版本${i + 1}`,
        durationSec: r.durationSec,
        spec: r.spec,
      }))
  );
  return {
    images: Array.from(
      new Map(images.map(image => [image.id, image])).values()
    ),
    scenes,
  };
}
