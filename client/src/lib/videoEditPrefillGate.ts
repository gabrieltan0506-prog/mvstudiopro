/**
 * 顾问预填防覆盖：唯一一套闸门。
 * 面板每次渲染把「此刻拒绝预填的原因」写进同一个 reason()（空串 = 可预填），三条入口都只问它：
 *   1. 面板自己登记给顾问的 videoEdit 控件（onAdvisorVideoEditControl）；
 *   2. 宿主自建控件经 useVideoEditPrefillGuard().withGuard 包住后的 prefill；
 *   3. 宿主直接改 prefill.nonce（面板已挂载之后的每一次）。
 * 被拒 = 面板内容与确认框原样保留，原因以中文回给顾问。面板刚挂载时带来的 prefill 视为「宿主打开面板并预填」，直接接受。
 */
import { useEffect, useMemo, useRef } from "react";
import type { AdvisorVideoEditControl, AdvisorVideoEditRegistration } from "@/lib/manhuaAdvisorWorkflowControl";

export type VideoEditPrefillGateState = { running: boolean; submitting: boolean; confirming: boolean; disabled?: boolean; quoting: boolean };

/**
 * 面板此刻不接受顾问预填的中文原因（回给顾问原话），空串 = 可预填。
 * 任务进行中 > 正在提交 > 用户确认中 > 面板停用 > 正在报价。
 */
export function videoEditPrefillBlockReason(s: VideoEditPrefillGateState): string {
  if (s.running) return "局部修改任务进行中，未改动面板内容，请等任务完成后再预填";
  if (s.submitting) return "用户正在提交局部修改，未改动面板内容";
  if (s.confirming) return "用户正在确认局部修改，未改动面板内容";
  if (s.disabled) return "局部修改面板暂不可操作，未改动面板内容";
  if (s.quoting) return "面板正在计算所需积分，未改动面板内容，请稍后再预填";
  return "";
}

/** prefill 前先问闸门：有原因即原样拒绝（不调用原控件、不改任何状态）；inspect 照常。 */
export function guardAdvisorPrefill(control: AdvisorVideoEditControl, reason: () => string): AdvisorVideoEditControl {
  return async (action, signal) => {
    const held = action.operation === "prefill" ? reason() : "";
    if (held) throw new Error(held);
    return control(action, signal);
  };
}

/**
 * 宿主侧：自建顾问 videoEdit 控件（清单 + 打开面板 + prefill nonce）时用。
 * register 交给面板 onAdvisorPrefillGuard，withGuard 包住宿主控件；面板未挂载时照常打开并预填。
 */
export function useVideoEditPrefillGuard() {
  const guard = useRef<(() => string) | null>(null);
  return useMemo(
    () => ({
      register: (g: (() => string) | null) => {
        guard.current = g;
      },
      withGuard: (control: AdvisorVideoEditControl) => guardAdvisorPrefill(control, () => guard.current?.() ?? ""),
    }),
    []
  );
}

export type VideoEditPrefillPayload = { startSec: number; endSec: number; promptZh: string; referenceImageUrls?: string[] };

/**
 * 面板侧：把三条入口接到同一个闸门上。
 * state 每次渲染传最新值；apply 只改区间/描述/参考图。buildControl 用 accept 作为面板控件的落地动作。
 */
export function useVideoEditPrefillGate(opts: {
  state: VideoEditPrefillGateState;
  apply: (p: VideoEditPrefillPayload) => void;
  /** 宿主 prefill（nonce 变化即一次预填请求）。 */
  prefill?: VideoEditPrefillPayload & { nonce: string | number };
  /** 面板自带的顾问控件（未加闸门的原控件）；每次调用取最新。 */
  buildControl: () => AdvisorVideoEditControl;
  onAdvisorVideoEditControl?: AdvisorVideoEditRegistration;
  onAdvisorPrefillGuard?: (guard: (() => string) | null) => void;
}): void {
  const live = useRef(opts);
  live.current = opts;
  const reason = useRef(() => videoEditPrefillBlockReason(live.current.state)).current;
  const mounted = useRef(false);

  const nonce = opts.prefill?.nonce;
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    const p = live.current.prefill;
    if (p && (first || !reason())) live.current.apply(p);
  }, [nonce, reason]);

  const registerControl = opts.onAdvisorVideoEditControl;
  useEffect(() => {
    if (!registerControl) return;
    registerControl(guardAdvisorPrefill((action, signal) => live.current.buildControl()(action, signal), reason));
    return () => registerControl(null);
  }, [registerControl, reason]);

  const registerGuard = opts.onAdvisorPrefillGuard;
  useEffect(() => {
    if (!registerGuard) return;
    registerGuard(reason);
    return () => registerGuard(null);
  }, [registerGuard, reason]);
}
