/**
 * Bridge between Python creative-advisor sidecar and Node billing / workbench sync.
 * User-facing product name: 创作顾问 (never expose upstream project name).
 */

import { ENV } from "../_core/env";

export type ManhuaAgentPendingActionType =
  | "confirm_visual_brief"
  | "generate_keyarts"
  | "generate_clips"
  | "update_beats"
  | "update_story";

export type ManhuaAgentPendingAction = {
  id: string;
  type: ManhuaAgentPendingActionType;
  sessionId: string;
  userId: number | null;
  createdAt: string;
  payload: Record<string, unknown>;
  consumed?: boolean;
};

type SessionBinding = {
  sessionId: string;
  userId: number;
  updatedAt: string;
};

const pendingBySession = new Map<string, ManhuaAgentPendingAction[]>();
const sessionOwner = new Map<string, SessionBinding>();

function nowIso() {
  return new Date().toISOString();
}

function newActionId() {
  return `maa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getManhuaAgentSidecarBaseUrl(): string {
  return String(process.env.MANHUA_AGENT_SIDECAR_URL || "").trim().replace(/\/$/, "");
}

export function getManhuaAgentBridgeToken(): string {
  return String(
    process.env.MANHUA_AGENT_BRIDGE_TOKEN ||
      process.env.HOST_BRIDGE_TOKEN ||
      process.env.MANHUA_AGENT_SIDECAR_TOKEN ||
      "",
  ).trim();
}

export function isManhuaAgentSidecarConfigured(): boolean {
  return Boolean(getManhuaAgentSidecarBaseUrl());
}

export function bindManhuaAgentSession(userId: number, sessionId: string) {
  sessionOwner.set(sessionId, { sessionId, userId, updatedAt: nowIso() });
}

export function getManhuaAgentSessionOwner(sessionId: string): number | null {
  return sessionOwner.get(sessionId)?.userId ?? null;
}

export function pushManhuaAgentPendingAction(
  input: Omit<ManhuaAgentPendingAction, "id" | "createdAt" | "consumed">,
): ManhuaAgentPendingAction {
  const action: ManhuaAgentPendingAction = {
    ...input,
    id: newActionId(),
    createdAt: nowIso(),
    consumed: false,
  };
  const list = pendingBySession.get(input.sessionId) || [];
  list.push(action);
  // Keep last 40
  pendingBySession.set(input.sessionId, list.slice(-40));
  return action;
}

export function listManhuaAgentPendingActions(
  sessionId: string,
  opts?: { includeConsumed?: boolean },
): ManhuaAgentPendingAction[] {
  const list = pendingBySession.get(sessionId) || [];
  if (opts?.includeConsumed) return [...list];
  return list.filter((a) => !a.consumed);
}

export function consumeManhuaAgentPendingAction(
  sessionId: string,
  actionId: string,
): ManhuaAgentPendingAction | null {
  const list = pendingBySession.get(sessionId) || [];
  const hit = list.find((a) => a.id === actionId);
  if (!hit) return null;
  hit.consumed = true;
  return hit;
}

export function verifyManhuaAgentBridgeToken(headerToken: string | undefined): boolean {
  const expected = getManhuaAgentBridgeToken();
  if (!expected) {
    // Dev fallback: allow only when not production and sidecar is local/unset.
    const base = getManhuaAgentSidecarBaseUrl();
    const local =
      base.includes("127.0.0.1") || base.includes("localhost") || !base;
    return local && !ENV.isProduction;
  }
  return String(headerToken || "").trim() === expected;
}

export async function callManhuaAgentSidecar<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const base = getManhuaAgentSidecarBaseUrl();
  if (!base) {
    return { ok: false, error: "sidecar_unconfigured" };
  }
  const token = getManhuaAgentBridgeToken();
  try {
    const res = await fetch(`${base}${path}`, {
      method: init?.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? {
              Authorization: `Bearer ${token}`,
              "X-Manhua-Agent-Token": token,
            }
          : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { detail?: string; error?: string };
    if (!res.ok) {
      return {
        ok: false,
        error: String((data as { detail?: string; error?: string }).detail || (data as { error?: string }).error || `HTTP ${res.status}`),
        status: res.status,
      };
    }
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "sidecar_unreachable",
    };
  }
}
