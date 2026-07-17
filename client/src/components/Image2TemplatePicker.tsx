import {
  listImage2TemplatesByGroup,
  buildImage2TemplatePrompt,
} from "@shared/image2PromptTemplates";

export default function Image2TemplatePicker({
  disabled,
  onApply,
}: {
  disabled?: boolean;
  onApply: (prompt: string, meta: { id: string; labelZh: string; needsReference: boolean }) => void;
}) {
  const groups = listImage2TemplatesByGroup();
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3">
      <div>
        <div className="text-sm font-semibold text-white/80">Image-2 一键模板</div>
        <p className="mt-0.5 text-[10px] text-white/40">按类别选择；带「·图」须先上传参考图。</p>
      </div>
      {groups.map(({ group, items }) => (
        <div key={group.id}>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
            {group.labelZh}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                title={t.blurbZh}
                onClick={() =>
                  onApply(buildImage2TemplatePrompt(t.id), {
                    id: t.id,
                    labelZh: t.labelZh,
                    needsReference: t.needsReference,
                  })
                }
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/75 hover:border-white/30 disabled:opacity-40"
              >
                {t.labelZh}
                {t.needsReference ? <span className="ml-1 text-amber-200/70">·图</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
