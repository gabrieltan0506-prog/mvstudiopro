import type {
  CanvasMusicCandidate,
  CanvasMusicMvState,
} from "@shared/canvasMusicMv";

/** 保持历史顺序和全部候选，同一身份只更新新签名与元信息。 */
export function mergeMusicCandidates(
  existing: CanvasMusicCandidate[],
  incoming: CanvasMusicCandidate[]
): CanvasMusicCandidate[] {
  const entries = new Map(existing.map(row => [row.id, row]));
  incoming.forEach(row => entries.set(row.id, row));
  return Array.from(entries.values());
}

/** 选歌或改创意后仅撤销当前链路引用，历史镜头和成片留在画布。 */
export function invalidateMusicMvPlan(
  state: CanvasMusicMvState
): CanvasMusicMvState {
  return {
    ...state,
    planTerminalStatus: undefined,
    plan: undefined,
    planRequestId: undefined,
    planInput: undefined,
    shotBlockIds: undefined,
    assembleRequestId: undefined,
    assembleJobId: undefined,
    assembleInput: undefined,
    assembleTerminalStatus: undefined,
    finalBlockId: undefined,
    status: state.selectedCandidateId ? "music_ready" : "idle",
    error: undefined,
  };
}

export function musicPlanInputKey(
  state: CanvasMusicMvState,
  fallbackPrompt: string
): string {
  const selected = state.candidates.find(
    row => row.id === state.selectedCandidateId
  );
  // 临时签名刷新不代表创作输入变化。
  return JSON.stringify([
    selected?.id,
    selected?.durationSec,
    state.lyrics || "",
    state.creativePrompt || fallbackPrompt,
    (state.referenceImages || []).map(row => [
      row.id,
      row.gcsUri || row.url,
      row.fileName,
    ]),
  ]);
}

export async function refreshMusicCandidate(
  candidate: CanvasMusicCandidate,
  sign: (identity: string) => Promise<string>
): Promise<CanvasMusicCandidate> {
  if (!candidate.gcsUri) return candidate;
  const url = await sign(candidate.gcsUri);
  if (!url.startsWith("https://"))
    throw new Error("音乐地址续期失败，请查询原音乐任务");
  return { ...candidate, url };
}

/** 状态文案可因网络错误变化，但未知分镜的原请求身份仍需锁定。 */
export function hasPendingMusicMvPlan(
  state: CanvasMusicMvState | undefined
): boolean {
  return Boolean(
    state?.planRequestId && !state.plan && !state.planTerminalStatus
  );
}

/** 同一歌曲候选恢复自己的歌词与MV构思，未知旧来源不借用新歌内容。 */
export function selectMusicCandidateContext(
  state: CanvasMusicMvState,
  id: string
) {
  const contexts = { ...state.candidateContexts };
  if (
    state.selectedCandidateId &&
    state.lyricsCandidateId === state.selectedCandidateId
  )
    contexts[state.selectedCandidateId] = {
      lyrics: state.lyrics || "",
      creativePrompt: state.creativePrompt || "",
    };
  const chosen = contexts[id] || { lyrics: "", creativePrompt: "" };
  return { candidateContexts: contexts, lyricsCandidateId: id, ...chosen };
}

export function captureMusicCandidateContexts(
  state: CanvasMusicMvState,
  jobId: string,
  ids: string[]
) {
  const contexts = { ...state.candidateContexts };
  if (
    !state.musicSubmission ||
    !state.musicRequestId ||
    jobId !== `bgm_${state.musicRequestId.replace(/-/g, "")}`
  )
    return contexts;
  for (const id of ids)
    if (!contexts[id])
      contexts[id] = {
        lyrics: state.musicSubmission.instrumental
          ? ""
          : state.musicSubmission.prompt,
        creativePrompt: state.musicSubmissionDirection || "",
      };
  return contexts;
}
