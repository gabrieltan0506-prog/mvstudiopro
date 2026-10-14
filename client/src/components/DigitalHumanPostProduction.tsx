import { useMemo, useRef } from "react";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import PostProdWorkshopCard from "./canvas/PostProdWorkshopCard";

/** 共用真实后期工具，素材和恢复数据只来自本数字人制作稿。 */
export function DigitalHumanPostProduction(props: {
  draft: DigitalHumanDraft; disabled: boolean; userRole?: string | null;
  save: (update: (current: DigitalHumanDraft) => DigitalHumanDraft) => void;
  beforeSubmit: () => Promise<void>; acquireWork: (label: string) => () => void;
}) {
  const latest = useRef(props); latest.current = props;
  const storage = useMemo<Storage>(() => ({
    get length() { return Object.keys(latest.current.draft.postProdStorage).length; },
    key: i => Object.keys(latest.current.draft.postProdStorage)[i] ?? null,
    getItem: key => latest.current.draft.postProdStorage[key] ?? null,
    setItem: (key, value) => {
      if (latest.current.draft.postProdStorage[key] === value) return;
      latest.current.save(d => ({ ...d, postProdStorage: { ...d.postProdStorage, [key]: value } }));
    },
    removeItem: key => latest.current.save(d => { const next = { ...d.postProdStorage }; delete next[key]; return { ...d, postProdStorage: next }; }),
    clear: () => latest.current.save(d => ({ ...d, postProdStorage: {} })),
  }), []);
  const media = useMemo(() => ({
    story: props.draft.script,
    clips: [
      ...props.draft.videos.flatMap((v, i) => v.status === "succeeded" && v.source ? [{ id: v.requestId, url: v.source, label: v.segment ? `口播第${v.segment.index + 1}段 · 版本${i + 1}` : `口播原片 · 版本${i + 1}` }, ...(v.upscale?.status === "succeeded" && v.upscale.source ? [{ id: `${v.requestId}:upscale`, url: v.upscale.source, label: `高清原片 · 版本${i + 1}` }] : [])] : []),
      ...props.draft.productions.flatMap((p, i) => p.status === "succeeded" && p.source && p.request.input.action === "digital_human_final" ? [{ id: p.request.requestId, url: p.source, label: `完整原声混音成片 · 版本${i + 1}` }] : []),
    ],
    audio: props.draft.mix.tracks.map((t, i) => ({ id: `track:${i}`, url: t.source, label: t.name })),
  }), [props.draft.videos, props.draft.productions, props.draft.script, props.draft.mix.tracks]);
  return <section className="dh-wide rounded-2xl bg-slate-950 p-2 text-white">
    <h3 className="p-3 text-lg font-semibold">手动剪辑与输出</h3>
    <p className="px-3 text-sm text-white/65">选择已有原片或完整混音成片，剪辑、混音、添加字幕和导出。取段会同步裁剪画面与原音轨；数字人的完整配音同步合成在上方完成。</p>
    <fieldset disabled={props.disabled}>
      <PostProdWorkshopCard key={props.draft.id} blocks={[]} userId={props.draft.owner} userRole={props.userRole}
        vfxScopeKey={`digital-human:${props.draft.id}`} projectScopeKey={`digital-human:${props.draft.id}`}
        mediaInput={media} storage={storage} beforeSubmit={props.beforeSubmit} acquireWork={props.acquireWork} disabled={props.disabled} />
    </fieldset>
  </section>;
}
