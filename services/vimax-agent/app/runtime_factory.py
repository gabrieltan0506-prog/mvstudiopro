"""Build AgentLoop with host-bridged tools (no RenderBackend)."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from agent_runtime.loop import build_runtime
from agent_runtime.session_index import SessionIndex

from .host_bridge_tools import build_host_adapter_specs


def ensure_workspace(workspace_root: str | Path, vendor_root: str | Path) -> Path:
    root = Path(workspace_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / ".working_dir").mkdir(parents=True, exist_ok=True)
    (root / ".vimax").mkdir(parents=True, exist_ok=True)
    prompts_dst = root / "prompts"
    prompts_src = Path(vendor_root).resolve() / "prompts"
    if prompts_src.is_dir() and not prompts_dst.exists():
        shutil.copytree(prompts_src, prompts_dst)
    # Soften product wording in agent system prompt copy if present.
    agent_md = prompts_dst / "agent.md"
    if agent_md.is_file():
        text = agent_md.read_text(encoding="utf-8")
        scrubbed = (
            text.replace("ViMax", "creative advisor")
            .replace("vimax", "advisor")
        )
        if scrubbed != text:
            agent_md.write_text(scrubbed, encoding="utf-8")
    return root


def create_runtime(workspace_root: str | Path, *, default_session_id: str = "") -> Any:
    root = Path(workspace_root).resolve()
    session_index = SessionIndex(root)

    def adapter_specs_factory(workspace: str | Path, index: Any) -> list[Any]:
        return build_host_adapter_specs(str(workspace), index, default_session_id=default_session_id)

    # build_runtime expects adapter_specs list, not factory — pass computed specs.
    specs = adapter_specs_factory(root, session_index)
    return build_runtime(root, adapter_specs=specs)


def workspace_from_env() -> Path:
    vendor = Path(__file__).resolve().parents[1] / "vendor" / "vimax"
    raw = os.environ.get("MANHUA_AGENT_WORKSPACE") or str(
        Path(__file__).resolve().parents[1] / "data" / "workspace"
    )
    return ensure_workspace(raw, vendor)
