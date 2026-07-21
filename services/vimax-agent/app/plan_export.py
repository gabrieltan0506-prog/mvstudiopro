"""Export planning artifacts from a session working_dir into a host-sync JSON shape."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _dialogue_from_audio(audio_desc: str) -> str:
    text = str(audio_desc or "").strip()
    if not text:
        return ""
    # [Speaker] Name (Emotion): line
    m = re.search(r"\[Speaker\][^\n:]*:\s*(.+)$", text, re.I | re.M)
    if m:
        return m.group(1).strip().strip('"').strip("'")
    m2 = re.search(r'["「]([^"」]+)["」]', text)
    if m2:
        return m2.group(1).strip()
    return ""


def _emotion_from_audio(audio_desc: str) -> str:
    text = str(audio_desc or "").strip()
    m = re.search(r"\[Speaker\][^(]*\(([^)]+)\)", text, re.I)
    return m.group(1).strip() if m else ""


def _camera_from_visual(visual_desc: str) -> tuple[str, str]:
    text = str(visual_desc or "").strip()
    if not text:
        return "", ""
    # Heuristic: first clause often carries framing
    first = re.split(r"[。.]", text, maxsplit=1)[0].strip()
    camera_tokens = (
        "远景|大远景|全景|中全景|中景|中近景|近景|特写|大特写|过肩|双人镜头|"
        "over-the-shoulder|close-up|medium shot|wide shot|eye level|low angle|high angle"
    )
    m = re.search(rf"(?i)\b({camera_tokens})\b", first)
    if m:
        cam = m.group(1).strip()
        action = text
        return cam, action
    return "", text


def _shots_from_storyboard(storyboard: Any) -> list[dict[str, Any]]:
    if not isinstance(storyboard, list):
        return []
    shots: list[dict[str, Any]] = []
    for i, raw in enumerate(storyboard):
        if not isinstance(raw, dict):
            continue
        idx = raw.get("idx")
        index = int(idx) + 1 if isinstance(idx, int) else i + 1
        visual = str(raw.get("visual_desc") or "").strip()
        audio = str(raw.get("audio_desc") or "").strip()
        camera_zh, action_zh = _camera_from_visual(visual)
        shots.append(
            {
                "index": index,
                "durationSec": 10,
                "cameraZh": camera_zh or "中景，平视",
                "actionZh": action_zh or visual,
                "dialogueZh": _dialogue_from_audio(audio) or None,
                "emotionZh": _emotion_from_audio(audio) or None,
                "visualDesc": visual,
                "audioDesc": audio,
            }
        )
    return shots


def _collect_storyboard_paths(working_dir: Path) -> list[Path]:
    paths: list[Path] = []
    script_board = working_dir / "script2video" / "storyboard.json"
    if script_board.is_file():
        paths.append(script_board)
    idea_root = working_dir / "idea2video"
    if idea_root.is_dir():
        for scene_dir in sorted(idea_root.glob("scene_*")):
            board = scene_dir / "storyboard.json"
            if board.is_file():
                paths.append(board)
    return paths


def export_session_plan(working_dir: str | Path) -> dict[str, Any]:
    root = Path(working_dir).resolve()
    characters: Any = None
    story = ""
    script = ""

    for candidate in [
        root / "idea2video" / "characters.json",
        root / "script2video" / "characters.json",
        root / "idea2video" / "characters.txt",
        root / "script2video" / "characters.txt",
    ]:
        if not candidate.is_file():
            continue
        if candidate.suffix == ".json":
            characters = _read_json(candidate)
        else:
            characters = _read_text(candidate)
        break

    for candidate in [
        root / "idea2video" / "story.txt",
        root / "idea2video" / "story.md",
    ]:
        if candidate.is_file():
            story = _read_text(candidate)
            break

    for candidate in [
        root / "script2video" / "script.txt",
        root / "idea2video" / "script.txt",
    ]:
        if candidate.is_file():
            script = _read_text(candidate)
            break

    shots: list[dict[str, Any]] = []
    boards: list[Any] = []
    for board_path in _collect_storyboard_paths(root):
        payload = _read_json(board_path)
        boards.append({"path": str(board_path.relative_to(root)), "shots": payload})
        if not shots:
            shots = _shots_from_storyboard(payload)

    return {
        "story": story,
        "script": script,
        "characters": characters,
        "shots": shots,
        "storyboards": boards,
        "workingDir": str(root),
    }
