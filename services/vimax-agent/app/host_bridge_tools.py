"""Host bridge tools: planning stays in vendored runtime; render goes to Node."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from agent_runtime.models import ToolResult
from agent_runtime.tools import ToolArgumentSchema, ToolRuntimeContext, ToolSpec
from agent_runtime.vimax_adapters import build_vimax_adapter_specs


def _bridge_base() -> str:
    return (os.environ.get("HOST_BRIDGE_URL") or "").rstrip("/")


def _bridge_token() -> str:
    return os.environ.get("HOST_BRIDGE_TOKEN") or ""


async def _post_bridge(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    base = _bridge_base()
    if not base:
        return {
            "ok": False,
            "error": "HOST_BRIDGE_URL is not configured; image/video tools cannot run on this sidecar.",
        }
    headers = {
        "Content-Type": "application/json",
        "X-Manhua-Agent-Bridge-Token": _bridge_token(),
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(f"{base}{path}", headers=headers, json=payload)
        try:
            data = resp.json()
        except Exception:
            data = {"ok": False, "error": resp.text[:500]}
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": data.get("error") or data.get("message") or f"HTTP {resp.status_code}",
                "status": resp.status_code,
                "raw": data,
            }
        if isinstance(data, dict):
            return data
        return {"ok": True, "data": data}


class HostBridgeAdapters:
    def __init__(self, default_session_id: str = "") -> None:
        self.default_session_id = default_session_id

    def _session_id(self, args: dict[str, Any]) -> str:
        return str(args.get("session_id") or self.default_session_id or "").strip()

    async def confirm_visual_brief(self, args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        session_id = self._session_id(args)
        result = await _post_bridge(
            "/api/internal/manhua-agent-bridge/confirm-visual-brief",
            {
                "sessionId": session_id,
                "confirmed": bool(args.get("confirmed", True)),
                "note": str(args.get("note") or ""),
            },
        )
        ok = bool(result.get("ok"))
        return ToolResult(
            "confirm_visual_brief",
            ok,
            json.dumps(result, ensure_ascii=False),
            result if isinstance(result, dict) else {"result": result},
        )

    async def generate_keyarts(self, args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        session_id = self._session_id(args)
        result = await _post_bridge(
            "/api/internal/manhua-agent-bridge/generate-keyarts",
            {
                "sessionId": session_id,
                "shotIndexes": args.get("shot_indexes") or args.get("shotIndexes") or [],
                "force": bool(args.get("force", False)),
                "note": str(args.get("note") or ""),
            },
        )
        ok = bool(result.get("ok"))
        return ToolResult(
            "generate_keyarts",
            ok,
            json.dumps(result, ensure_ascii=False),
            result if isinstance(result, dict) else {"result": result},
        )

    async def generate_clips(self, args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        session_id = self._session_id(args)
        result = await _post_bridge(
            "/api/internal/manhua-agent-bridge/generate-clips",
            {
                "sessionId": session_id,
                "shotIndexes": args.get("shot_indexes") or args.get("shotIndexes") or [],
                "force": bool(args.get("force", False)),
                "note": str(args.get("note") or ""),
            },
        )
        ok = bool(result.get("ok"))
        return ToolResult(
            "generate_clips",
            ok,
            json.dumps(result, ensure_ascii=False),
            result if isinstance(result, dict) else {"result": result},
        )

    async def update_beats(self, args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        session_id = self._session_id(args)
        result = await _post_bridge(
            "/api/internal/manhua-agent-bridge/update-beats",
            {
                "sessionId": session_id,
                "beatsText": str(args.get("beats_text") or args.get("beatsText") or ""),
                "note": str(args.get("note") or ""),
            },
        )
        ok = bool(result.get("ok"))
        return ToolResult(
            "update_beats",
            ok,
            json.dumps(result, ensure_ascii=False),
            result if isinstance(result, dict) else {"result": result},
        )

    async def update_story(self, args: dict[str, Any], runtime: ToolRuntimeContext | None = None) -> ToolResult:
        session_id = self._session_id(args)
        result = await _post_bridge(
            "/api/internal/manhua-agent-bridge/update-story",
            {
                "sessionId": session_id,
                "storyText": str(args.get("story_text") or args.get("storyText") or ""),
                "note": str(args.get("note") or ""),
            },
        )
        ok = bool(result.get("ok"))
        return ToolResult(
            "update_story",
            ok,
            json.dumps(result, ensure_ascii=False),
            result if isinstance(result, dict) else {"result": result},
        )


def build_host_adapter_specs(workspace_root: str, session_index: Any, *, default_session_id: str = "") -> list[ToolSpec]:
    """Narrative planning from vendored adapters; replace render with host bridge tools."""
    vimax_specs = build_vimax_adapter_specs(workspace_root, session_index)
    # First release: narrative planning only from upstream; no novel / no RenderBackend.
    keep = [s for s in vimax_specs if s.name == "vimax_narrative_planning"]
    # Rename for user-facing agent prompts without leaking upstream product name in tool text.
    if keep:
        keep[0] = ToolSpec(
            name=keep[0].name,
            description=(
                "Create or revise structured text artifacts for the active creative session. "
                "Idea mode writes story, characters, script, and scene-level storyboard under idea2video/. "
                "Script mode writes characters and storyboard under script2video/. "
                "Does not generate keyframes or video clips — call generate_keyarts / generate_clips after the user confirms the visual brief."
            ),
            handler=keep[0].handler,
            schema=keep[0].schema,
            aliases=keep[0].aliases,
            permission_mode=keep[0].permission_mode,
            json_schema=keep[0].json_schema,
            concurrency_safe=keep[0].concurrency_safe,
        )

    host = HostBridgeAdapters(default_session_id=default_session_id)
    host_specs = [
        ToolSpec(
            name="confirm_visual_brief",
            description=(
                "Mark the visual brief checkpoint as confirmed (or revoked) on the host workbench. "
                "Call this before generate_keyarts when the user explicitly confirms the brief."
            ),
            handler=host.confirm_visual_brief,
            schema={
                "session_id": ToolArgumentSchema(str, required=False, default=""),
                "confirmed": ToolArgumentSchema(bool, required=False, default=True),
                "note": ToolArgumentSchema(str, required=False, default=""),
            },
        ),
        ToolSpec(
            name="generate_keyarts",
            description=(
                "Request still keyarts for shots via the host billing and jobs pipeline. "
                "Does not call any local render backend. Prefer after confirm_visual_brief."
            ),
            handler=host.generate_keyarts,
            schema={
                "session_id": ToolArgumentSchema(str, required=False, default=""),
                "shot_indexes": ToolArgumentSchema(list, required=False, default=[]),
                "force": ToolArgumentSchema(bool, required=False, default=False),
                "note": ToolArgumentSchema(str, required=False, default=""),
            },
        ),
        ToolSpec(
            name="generate_clips",
            description=(
                "Request short clips for shots via the host billing and jobs pipeline. "
                "Does not call any local render backend."
            ),
            handler=host.generate_clips,
            schema={
                "session_id": ToolArgumentSchema(str, required=False, default=""),
                "shot_indexes": ToolArgumentSchema(list, required=False, default=[]),
                "force": ToolArgumentSchema(bool, required=False, default=False),
                "note": ToolArgumentSchema(str, required=False, default=""),
            },
        ),
        ToolSpec(
            name="update_beats",
            description="Push revised episode beats text back to the host workbench sync buffer.",
            handler=host.update_beats,
            schema={
                "session_id": ToolArgumentSchema(str, required=False, default=""),
                "beats_text": ToolArgumentSchema(str, required=True),
                "note": ToolArgumentSchema(str, required=False, default=""),
            },
        ),
        ToolSpec(
            name="update_story",
            description="Push revised story text back to the host workbench sync buffer.",
            handler=host.update_story,
            schema={
                "session_id": ToolArgumentSchema(str, required=False, default=""),
                "story_text": ToolArgumentSchema(str, required=True),
                "note": ToolArgumentSchema(str, required=False, default=""),
            },
        ),
    ]
    return [*keep, *host_specs]
