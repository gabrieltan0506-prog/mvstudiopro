import type { AdvisorEffectsAction, AdvisorEffectsControl } from "@shared/manhuaAdvisorEffects";

/** A mounted controller may still belong to the previously selected segment. Probe its identity first. */
export async function executeAdvisorEffectsWhenReady(input: {
  action: AdvisorEffectsAction;
  signal: AbortSignal;
  getControl: () => AdvisorEffectsControl | undefined;
  isCurrent: () => boolean;
  beforeMutation?: () => void;
  wait?: () => Promise<void>;
  attempts?: number;
}): Promise<string> {
  const assertCurrent = () => {
    input.signal.throwIfAborted();
    if (!input.isCurrent()) throw new Error("作品、片段范围或备份状态已变化，未操作旧特效方案");
  };
  for (let attempt = 0; attempt < (input.attempts ?? 40); attempt++) {
    assertCurrent();
    const control = input.getControl();
    if (control) {
      let ready = !input.action.clipId;
      if (input.action.clipId) {
        try {
          const current = JSON.parse(await control({ action: "effects", tool: input.action.tool, operation: "inspect" }, input.signal));
          ready = current.clipId === input.action.clipId && typeof current.sourceKey === "string";
        } catch { /* A changing/unmounted controller is not the requested target. */ }
      }
      assertCurrent();
      if (ready && input.getControl() === control) {
        if (input.action.operation !== "inspect") input.beforeMutation?.();
        assertCurrent();
        const receipt = await control(input.action, input.signal);
        assertCurrent();
        return receipt;
      }
    }
    await (input.wait?.() ?? new Promise(resolve => setTimeout(resolve, 150)));
  }
  throw new Error("目标片段的原特效控件尚未就绪，未提交或采用，请先打开对应工具");
}
