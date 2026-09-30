import { ADVISOR_GENERATION_STATE_ZH, type AdvisorGenerationStep } from "@/lib/manhuaAdvisorGenerationMonitor";

/** 顾问的只读监看面板；打开/定位不会调用模型或自动生成。 */
export default function ManhuaAdvisorGenerationMonitor({ steps, onLocate }: {
  steps: AdvisorGenerationStep[];
  onLocate?: (phase: AdvisorGenerationStep["phase"]) => void;
}) {
  return <section aria-label="生成步骤检查" data-advisor-generation-monitor className="space-y-2 rounded-lg border border-cyan-300/20 p-3 text-xs">
    <h3 className="font-semibold text-white/85">生成步骤检查 · 随当前项目更新</h3>
    <p className="leading-5 text-white/55">只读任务与保存状态，不消耗咨询次数。已有产物仍需审片；没有回执时不会猜测成功。</p>
    {steps.map(step => <details key={step.id} data-advisor-generation-step={step.id} open={step.problems.length > 0} className="rounded border border-white/10 px-2 py-1.5">
      <summary className="cursor-pointer leading-5 text-white/75">{step.label} · {ADVISOR_GENERATION_STATE_ZH[step.state]}<span className="block text-white/50">{step.summary}</span></summary>
      {step.problems.map(problem => <div key={problem.id} className="mt-2 space-y-1 border-t border-white/10 pt-2 leading-5 text-white/70">
        <p>需处理：{problem.reason}</p>
        <p>处理办法：{problem.resolution}</p>
      </div>)}
      {onLocate && <button type="button" onClick={() => onLocate(step.phase)} className="mt-2 rounded border border-cyan-300/30 px-2 py-1 text-cyan-100">打开{step.label}步骤</button>}
    </details>)}
  </section>;
}
