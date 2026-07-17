import { IMAGE2_PROMPT_TEMPLATES, buildImage2TemplatePrompt } from "@shared/image2PromptTemplates";

export default function Image2TemplatePicker({
  disabled,
  onApply,
}: {
  disabled?: boolean;
  onApply: (prompt: string, meta: { id: string; labelZh: string; needsReference: boolean }) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-white/80">Image-2 一键模板</div>
      <div className="flex flex-wrap gap-1.5">
        {IMAGE2_PROMPT_TEMPLATES.map((t) => (
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
      <p className="text-[10px] text-white/40">带「·图」的模板请先上传参考图再生成。</p>
    </div>
  );
}
