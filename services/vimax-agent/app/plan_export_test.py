"""Lightweight tests for plan_export (no LLM / fastapi required)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.plan_export import export_session_plan


class PlanExportTest(unittest.TestCase):
    def test_export_script2video_storyboard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script_dir = root / "script2video"
            script_dir.mkdir(parents=True)
            (script_dir / "script.txt").write_text("剧本正文", encoding="utf-8")
            board = [
                {
                    "idx": 0,
                    "visual_desc": "特写，女主压住哭腔看着门口。",
                    "audio_desc": '[Speaker] 女主 (委屈): "你说过会回来"',
                },
                {
                    "idx": 1,
                    "visual_desc": "中景，男主背对停住。",
                    "audio_desc": "",
                },
            ]
            (script_dir / "storyboard.json").write_text(
                json.dumps(board, ensure_ascii=False), encoding="utf-8"
            )
            plan = export_session_plan(root)
            self.assertEqual(plan["script"], "剧本正文")
            self.assertEqual(len(plan["shots"]), 2)
            self.assertEqual(plan["shots"][0]["index"], 1)
            self.assertIn("哭腔", plan["shots"][0]["actionZh"])
            self.assertEqual(plan["shots"][0]["dialogueZh"], "你说过会回来")
            self.assertEqual(plan["shots"][0]["emotionZh"], "委屈")


if __name__ == "__main__":
    unittest.main()
