export type ManhuaSubtitleTaskGateState = {
  submitting: boolean;
  pollingJobIds: readonly string[];
};

export type ManhuaSubtitleTaskGateTransition = {
  acquired: boolean;
  state: ManhuaSubtitleTaskGateState;
};

export function createManhuaSubtitleTaskGate(): ManhuaSubtitleTaskGateState {
  return { submitting: false, pollingJobIds: [] };
}

/** 同步提交锁：在 React 状态提交前就拒绝同一页面的第二次下单。 */
export function beginManhuaSubtitleSubmit(
  state: ManhuaSubtitleTaskGateState,
): ManhuaSubtitleTaskGateTransition {
  if (state.submitting || state.pollingJobIds.length > 0) {
    return { acquired: false, state };
  }
  return { acquired: true, state: { ...state, submitting: true } };
}

export function finishManhuaSubtitleSubmit(
  state: ManhuaSubtitleTaskGateState,
): ManhuaSubtitleTaskGateState {
  return state.submitting ? { ...state, submitting: false } : state;
}

/** 同一 job 只允许一个轮询；不同集的 job 可并行并纳入同一个忙碌计数。 */
export function beginManhuaSubtitlePoll(
  state: ManhuaSubtitleTaskGateState,
  rawJobId: unknown,
): ManhuaSubtitleTaskGateTransition {
  const jobId = String(rawJobId || "").trim();
  if (!jobId || state.pollingJobIds.includes(jobId)) {
    return { acquired: false, state };
  }
  return {
    acquired: true,
    state: { ...state, pollingJobIds: [...state.pollingJobIds, jobId] },
  };
}

export function finishManhuaSubtitlePoll(
  state: ManhuaSubtitleTaskGateState,
  rawJobId: unknown,
): ManhuaSubtitleTaskGateState {
  const jobId = String(rawJobId || "").trim();
  const pollingJobIds = state.pollingJobIds.filter((id) => id !== jobId);
  return pollingJobIds.length === state.pollingJobIds.length
    ? state
    : { ...state, pollingJobIds };
}

export function isManhuaSubtitleTaskBusy(state: ManhuaSubtitleTaskGateState): boolean {
  return state.submitting || state.pollingJobIds.length > 0;
}

export type ManhuaSubtitleErrorPhase = "submit" | "poll" | "job" | "refresh";

/**
 * 后期错误只按可安全识别的类别出前台文案；未知上游、网络与存储细节不回显。
 */
export function toManhuaSubtitlePublicError(
  error: unknown,
  phase: ManhuaSubtitleErrorPhase,
): string {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/未登录|Unauthorized|UNAUTHORIZED|\b401\b|登录状态.*失效/i.test(raw)) {
    return "登录状态已失效，请刷新页面重新登录；已入队任务仍会保留。";
  }
  if (/无权|Forbidden|FORBIDDEN|\b403\b/i.test(raw)) {
    return "无权读取该后期任务，请确认当前登录账号。";
  }
  if (/不存在|Not.?Found|NOT_FOUND|\b404\b/i.test(raw)) {
    return "后期任务记录暂不可用，请从后期任务列表重新取件。";
  }
  if (/超时|timed?.?out|timeout/i.test(raw)) {
    return "字幕烧录或取件超时，原片与任务记录已保留，可稍后继续取件。";
  }
  if (/长期成片身份缺失|长期版本身份缺失/.test(raw)) {
    return "字幕烧录已完成，但成片身份不完整，请从后期任务列表重新取件。";
  }
  if (/素材地址无法核对|未登记|source.*(?:invalid|denied)|video.*url.*invalid/i.test(raw)) {
    return "当前成片来源无法核对，请重新选择仍可播放的成片版本。";
  }
  if (/字幕.{0,8}(?:格式|为空|无效)|subtitle.{0,12}(?:invalid|empty|format)/i.test(raw)) {
    return "字幕内容或格式无效，请检查字幕轨后重试。";
  }
  if (phase === "submit") return "字幕烧录任务未能提交，请稍后重试。";
  if (phase === "job") return "字幕烧录未完成，原片与任务记录已保留。";
  if (phase === "refresh") return "历史成片链接刷新失败，长期版本身份仍已保留。";
  return "字幕任务查询暂时失败，任务记录已保留，可刷新后继续取件。";
}
