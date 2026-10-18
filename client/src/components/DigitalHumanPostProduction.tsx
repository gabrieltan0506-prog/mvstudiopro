import { useDigitalHumanStorage } from "@/lib/useDigitalHumanStorage";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { DigitalHumanPostProdWorkbench } from "./DigitalHumanPostProdWorkbench";
import { digitalHumanPostProdMedia } from "@/lib/digitalHumanPostProd";

/** 共用真实后期工具，素材和恢复数据只来自本数字人制作稿。 */
export function DigitalHumanPostProduction(props: {
  draft: DigitalHumanDraft; disabled: boolean; userRole?: string | null;
  save: (update: (current: DigitalHumanDraft) => DigitalHumanDraft) => void;
  beforeSubmit: () => Promise<void>; acquireWork: (label: string) => () => void;
}) {
  const storage = useDigitalHumanStorage(props.draft.postProdStorage, update => props.save(d => ({ ...d, postProdStorage: update(d.postProdStorage) })));
  const media = digitalHumanPostProdMedia(props.draft);
  return <section className="dh-wide rounded-2xl bg-slate-950 p-2 text-white">
    <h3 className="p-3 text-lg font-semibold">手动剪辑与输出</h3>
    <p className="px-3 text-sm text-white/65">选择已有原片或完整混音成片，剪辑、混音、添加字幕和导出。取段会同步裁剪画面与原音轨；数字人的完整配音同步合成在上方完成。</p>
    <fieldset disabled={props.disabled}>
      <DigitalHumanPostProdWorkbench key={props.draft.id} draft={props.draft} userRole={props.userRole}
        scope={`digital-human:${props.draft.id}`} media={media} storage={storage} beforeSubmit={props.beforeSubmit} acquireWork={props.acquireWork} disabled={props.disabled} />
    </fieldset>
  </section>;
}
