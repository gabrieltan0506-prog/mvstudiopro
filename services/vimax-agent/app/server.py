"""HTTP sidecar for manhua creative-advisor agent loop."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# Ensure vendored package roots are importable: agent_runtime, pipelines, agents, ...
_VENDOR = Path(__file__).resolve().parents[1] / "vendor" / "vimax"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))
_APP_PARENT = Path(__file__).resolve().parents[1]
if str(_APP_PARENT) not in sys.path:
    sys.path.insert(0, str(_APP_PARENT))

from app.plan_export import export_session_plan  # noqa: E402
from app.runtime_factory import create_runtime, workspace_from_env  # noqa: E402

app = FastAPI(title="manhua-agent-sidecar", version="0.1.0")

_WORKSPACE = workspace_from_env()
# One runtime per process; sessions are file-backed under workspace.
_RUNTIME = create_runtime(_WORKSPACE)


def _require_token(authorization: str | None, x_token: str | None) -> None:
    expected = os.environ.get("MANHUA_AGENT_SIDECAR_TOKEN") or os.environ.get("HOST_BRIDGE_TOKEN") or ""
    if not expected:
        return
    got = ""
    if authorization and authorization.lower().startswith("bearer "):
        got = authorization[7:].strip()
    elif x_token:
        got = x_token.strip()
    if got != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


class CreateSessionBody(BaseModel):
    idea: str = ""
    userRequirement: str = ""
    style: str = ""
    projectName: str = ""
    sessionId: str | None = None


class ChatBody(BaseModel):
    sessionId: str
    message: str = Field(min_length=1)
    resume: bool = True


class IdeaPlanBody(BaseModel):
    sessionId: str | None = None
    idea: str = Field(min_length=1)
    userRequirement: str = ""
    style: str = "Cinematic, coherent, vertical short drama"


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "workspace": str(_WORKSPACE),
        "bridgeConfigured": bool(os.environ.get("HOST_BRIDGE_URL")),
    }


@app.post("/session")
async def create_session(
    body: CreateSessionBody,
    authorization: str | None = Header(default=None),
    x_manhua_agent_token: str | None = Header(default=None, alias="X-Manhua-Agent-Token"),
) -> dict[str, Any]:
    _require_token(authorization, x_manhua_agent_token)
    session = _RUNTIME.session_index.create(
        idea=body.idea,
        user_requirement=body.userRequirement,
        style=body.style,
        session_id=body.sessionId,
        project_name=body.projectName,
    )
    return {"ok": True, "session": session}


@app.get("/session/{session_id}")
async def get_session(
    session_id: str,
    authorization: str | None = Header(default=None),
    x_manhua_agent_token: str | None = Header(default=None, alias="X-Manhua-Agent-Token"),
) -> dict[str, Any]:
    _require_token(authorization, x_manhua_agent_token)
    session = _RUNTIME.session_index.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session_not_found")
    working = _RUNTIME.session_index.working_dir(session_id)
    plan = export_session_plan(working)
    return {
        "ok": True,
        "session": session,
        "plan": plan,
        "snapshot": _RUNTIME.session_index.snapshot(),
    }


@app.post("/chat")
async def chat(
    body: ChatBody,
    authorization: str | None = Header(default=None),
    x_manhua_agent_token: str | None = Header(default=None, alias="X-Manhua-Agent-Token"),
) -> dict[str, Any]:
    _require_token(authorization, x_manhua_agent_token)
    session = _RUNTIME.session_index.get(body.sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="session_not_found")
    _RUNTIME.session_index.set_active(body.sessionId)

    events: list[dict[str, Any]] = []
    assistant_text = ""
    tool_results: list[dict[str, Any]] = []
    async for event in _RUNTIME.stream_events(body.message):
        events.append(event)
        if event.get("type") == "done":
            assistant_text = str(event.get("assistant") or "")
            tool_results = list(event.get("tool_results") or [])

    working = _RUNTIME.session_index.working_dir(body.sessionId)
    plan = export_session_plan(working)
    return {
        "ok": True,
        "sessionId": body.sessionId,
        "assistant": assistant_text,
        "toolResults": tool_results,
        "events": events[-40:],
        "plan": plan,
        "session": _RUNTIME.session_index.get(body.sessionId),
    }


@app.post("/run-idea2video-plan")
async def run_idea2video_plan(
    body: IdeaPlanBody,
    authorization: str | None = Header(default=None),
    x_manhua_agent_token: str | None = Header(default=None, alias="X-Manhua-Agent-Token"),
) -> dict[str, Any]:
    """Run narrative planning only (storyboard JSON), no render."""
    _require_token(authorization, x_manhua_agent_token)
    if body.sessionId:
        session = _RUNTIME.session_index.get(body.sessionId)
        if not session:
            session = _RUNTIME.session_index.create(
                idea=body.idea,
                user_requirement=body.userRequirement,
                style=body.style,
                session_id=body.sessionId,
            )
        else:
            _RUNTIME.session_index.set_active(body.sessionId)
    else:
        session = _RUNTIME.session_index.create(
            idea=body.idea,
            user_requirement=body.userRequirement,
            style=body.style,
        )
    session_id = session["session_id"]
    _RUNTIME.session_index.set_active(session_id)

    # Drive planning via the narrative tool through a focused user message.
    message = (
        f"请对以下创意做结构化编剧与分镜规划（仅文本产物，不要出图出片）。\n"
        f"idea: {body.idea}\n"
        f"user_requirement: {body.userRequirement or '竖屏漫剧，节奏紧，前三秒抓人'}\n"
        f"style: {body.style}\n"
        f"session_id: {session_id}\n"
        f"请调用 vimax_narrative_planning。"
    )
    events: list[dict[str, Any]] = []
    assistant_text = ""
    async for event in _RUNTIME.stream_events(message):
        events.append(event)
        if event.get("type") == "done":
            assistant_text = str(event.get("assistant") or "")

    working = _RUNTIME.session_index.working_dir(session_id)
    plan = export_session_plan(working)
    return {
        "ok": True,
        "sessionId": session_id,
        "assistant": assistant_text,
        "plan": plan,
        "session": _RUNTIME.session_index.get(session_id),
        "events": events[-40:],
    }


def main() -> None:
    import uvicorn

    host = os.environ.get("MANHUA_AGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("MANHUA_AGENT_PORT", "8091"))
    uvicorn.run("app.server:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
