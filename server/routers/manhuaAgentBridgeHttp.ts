/**
 * Internal HTTP routes called by the Python sidecar (host bridge tools).
 * Not for browser clients — token gated.
 */
import type { Express, Request, Response } from "express";
import {
  getManhuaAgentSessionOwner,
  pushManhuaAgentPendingAction,
  verifyManhuaAgentBridgeToken,
} from "../services/manhuaAgentLoopBridge";

function bridgeAuth(req: Request, res: Response): boolean {
  const token = String(
    req.headers["x-manhua-agent-bridge-token"] ||
      (String(req.headers.authorization || "").toLowerCase().startsWith("bearer ")
        ? String(req.headers.authorization).slice(7)
        : ""),
  ).trim();
  if (!verifyManhuaAgentBridgeToken(token)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function readBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
}

export function registerManhuaAgentBridgeHttpRoutes(app: Express) {
  app.post("/api/internal/manhua-agent-bridge/confirm-visual-brief", (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const body = readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId required" });
      return;
    }
    const action = pushManhuaAgentPendingAction({
      type: "confirm_visual_brief",
      sessionId,
      userId: getManhuaAgentSessionOwner(sessionId),
      payload: {
        confirmed: body.confirmed !== false,
        note: String(body.note || ""),
      },
    });
    res.json({
      ok: true,
      actionId: action.id,
      message:
        "Visual brief checkpoint queued for the workbench. Credits are charged when the user runs still/clip generation on the host.",
    });
  });

  app.post("/api/internal/manhua-agent-bridge/generate-keyarts", (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const body = readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId required" });
      return;
    }
    const action = pushManhuaAgentPendingAction({
      type: "generate_keyarts",
      sessionId,
      userId: getManhuaAgentSessionOwner(sessionId),
      payload: {
        shotIndexes: Array.isArray(body.shotIndexes) ? body.shotIndexes : [],
        force: Boolean(body.force),
        note: String(body.note || ""),
        billing: "host_jobs",
      },
    });
    res.json({
      ok: true,
      actionId: action.id,
      renderBackend: "host_jobs",
      message:
        "Keyart generation queued on host. Local RenderBackend is not used. Workbench will charge credits via existing factory/jobs.",
    });
  });

  app.post("/api/internal/manhua-agent-bridge/generate-clips", (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const body = readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId required" });
      return;
    }
    const action = pushManhuaAgentPendingAction({
      type: "generate_clips",
      sessionId,
      userId: getManhuaAgentSessionOwner(sessionId),
      payload: {
        shotIndexes: Array.isArray(body.shotIndexes) ? body.shotIndexes : [],
        force: Boolean(body.force),
        note: String(body.note || ""),
        billing: "host_jobs",
      },
    });
    res.json({
      ok: true,
      actionId: action.id,
      renderBackend: "host_jobs",
      message:
        "Clip generation queued on host. Local RenderBackend is not used. Workbench will charge credits via existing factory/jobs.",
    });
  });

  app.post("/api/internal/manhua-agent-bridge/update-beats", (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const body = readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId required" });
      return;
    }
    const action = pushManhuaAgentPendingAction({
      type: "update_beats",
      sessionId,
      userId: getManhuaAgentSessionOwner(sessionId),
      payload: {
        beatsText: String(body.beatsText || ""),
        note: String(body.note || ""),
      },
    });
    res.json({ ok: true, actionId: action.id, message: "Beats sync queued for workbench." });
  });

  app.post("/api/internal/manhua-agent-bridge/update-story", (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const body = readBody(req);
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId required" });
      return;
    }
    const action = pushManhuaAgentPendingAction({
      type: "update_story",
      sessionId,
      userId: getManhuaAgentSessionOwner(sessionId),
      payload: {
        storyText: String(body.storyText || ""),
        note: String(body.note || ""),
      },
    });
    res.json({ ok: true, actionId: action.id, message: "Story sync queued for workbench." });
  });
}
