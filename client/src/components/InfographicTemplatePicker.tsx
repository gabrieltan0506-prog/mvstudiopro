import {
  listInfographicTemplatesByMode,
  type InfographicNoteTemplate,
} from "@shared/infographicNoteTemplates";

export default function InfographicTemplatePicker({
  disabled,
  selectedTemplateId,
  onSelect,
}: {
  disabled?: boolean;
  selectedTemplateId?: string | null;
  onSelect: (template: InfographicNoteTemplate | null) => void;
}) {
  const groups = listInfographicTemplatesByMode();
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-white/80">百科可视化图文模板</div>
          <p className="mt-0.5 text-[10px] text-white/40">
            只锁定版式与信息密度风格；正文请写在下方输入框，生成时后台套用版式（不露出提示词）。
          </p>
        </div>
        {selectedTemplateId ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(null)}
            className="rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/55 hover:text-white disabled:opacity-40"
          >
            清除版式
          </button>
        ) : null}
      </div>
      {groups.map(({ mode, items }) => (
        <div key={mode.id}>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100/45">
            {mode.labelZh}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {items.map((t) => {
              const active = selectedTemplateId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  title={t.blurbZh}
                  onClick={() => onSelect(active ? null : t)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition disabled:opacity-40 ${
                    active
                      ? "border-cyan-300/70 bg-cyan-400/25 text-white"
                      : "border-cyan-400/25 bg-cyan-500/10 text-cyan-50/90 hover:border-cyan-300/45"
                  }`}
                >
                  {t.labelZh}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
