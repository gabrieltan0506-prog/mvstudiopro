import {
  manhuaPilotDecisionSchema,
  manhuaPilotReviewStateSchema,
  manhuaPilotScopeSchema,
  type ManhuaPilotDecision,
  type ManhuaPilotReviewState,
  type ManhuaPilotScope,
} from "@shared/manhuaPilotReview";
import { withLongJobsFlyDirect } from "./longJobsFlyOrigin";

/** 包含正文而非仅剧名；编辑正文后不会沿用旧项目批准。 */
export async function fingerprintManhuaPilotProject(
  confirmedAt: string,
  pack: unknown
): Promise<string> {
  if (!confirmedAt.trim() || !pack || typeof pack !== "object") {
    throw new Error("请先确认剧本，再生成试片");
  }
  // 云草稿重建对象时可能调整键顺序；不把同一份正文误当新项目而要求重复试片。
  const text = JSON.stringify([confirmedAt, pack], (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : value
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function readReviewResponse(
  response: Response
): Promise<ManhuaPilotReviewState> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true)
    throw new Error("试片审核记录暂时无法确认，请刷新审核状态后再继续");
  const parsed = manhuaPilotReviewStateSchema.safeParse(payload.review);
  if (!parsed.success)
    throw new Error("试片审核记录不完整，已停止放行；请刷新审核状态");
  return parsed.data;
}

export async function loadManhuaPilotReview(
  scope: ManhuaPilotScope
): Promise<ManhuaPilotReviewState> {
  const parsed = manhuaPilotScopeSchema.parse(scope);
  const query = new URLSearchParams({
    op: "manhuaPilotStatus",
    ...parsed,
    episodeIndex: String(parsed.episodeIndex),
  });
  return readReviewResponse(
    await fetch(withLongJobsFlyDirect(`/api/jobs?${query}`), {
      method: "GET",
      credentials: "include",
      signal: AbortSignal.timeout(20000),
    })
  );
}

export async function submitManhuaPilotDecision(
  input: ManhuaPilotDecision
): Promise<ManhuaPilotReviewState> {
  const decision = manhuaPilotDecisionSchema.parse(input);
  // 审批仅单发；回包未知时读原记录，不自动重复 POST。
  return readReviewResponse(
    await fetch(withLongJobsFlyDirect("/api/jobs?op=manhuaPilotReview"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
      signal: AbortSignal.timeout(20000),
    })
  );
}
