import { MANHUA_SECONDARY_TOOL_LABEL_ZH, type ManhuaSecondaryTool } from "@/lib/manhuaSecondaryTools";

/** 标签只切换已挂载的内容区，不改变页面或生成任务。 */
export function ManhuaSecondaryToolTabs({ active, tools, onSelect }: {
  active: ManhuaSecondaryTool;
  tools: ManhuaSecondaryTool[];
  onSelect: (tool: ManhuaSecondaryTool) => void;
}) {
  return <div role="tablist" aria-label="二级工具" className="sticky top-0 z-10 mb-4 flex flex-wrap gap-2 border-b border-white/15 bg-[#0a121c] pb-3">
    {tools.map((tool, index) => <button type="button" role="tab" id={`manhua-tool-tab-${tool}`} key={tool} aria-controls={`manhua-tool-panel-${tool}`} aria-selected={active === tool} tabIndex={active === tool ? 0 : -1}
      className={`min-h-11 rounded-lg border px-4 text-xs ${active === tool ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-50" : "border-white/20 text-white/70 hover:bg-white/10"}`}
      onClick={() => onSelect(tool)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % tools.length : event.key === "ArrowLeft" ? (index + tools.length - 1) % tools.length : event.key === "Home" ? 0 : event.key === "End" ? tools.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#manhua-tool-tab-${tools[next]}`);
        target?.focus(); onSelect(tools[next]);
      }}>{MANHUA_SECONDARY_TOOL_LABEL_ZH[tool]}</button>)}
  </div>;
}
