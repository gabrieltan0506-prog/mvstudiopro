import type { PlatformCreateStepId } from "@/lib/platformWorkbenchMode";

type Props = {
  activeStep: PlatformCreateStepId; onStepChange: (step: PlatformCreateStepId) => void;
  doneSteps?: Set<PlatformCreateStepId>; className?: string; orientation?: "vertical" | "horizontal";
};
const steps: Array<{id:PlatformCreateStepId;label:string;hint:string}> = [
  {id:"persona",label:"写下需求",hint:"背景、读者与本次要求"},
  {id:"topics",label:"选择方向",hint:"比较切口，确认选题"},
  {id:"result",label:"整理成稿",hint:"正文、分镜与视觉方案"},
];
export function PlatformCreateStepRail({activeStep,onStepChange,className=""}:Props){
 const current = activeStep === "skills" ? "persona" : activeStep === "copy" || activeStep === "output" ? "result" : activeStep;
 return <nav className={`creation-step-rail ${className}`} aria-label="创作步骤">{steps.map((step,i)=><button key={step.id} type="button" aria-current={current===step.id?"step":undefined} onClick={()=>onStepChange(step.id)}><span className="creation-step-number">{String(i+1).padStart(2,"0")}</span><span><strong>{step.label}</strong><small>{step.hint}</small></span></button>)}</nav>;
}
