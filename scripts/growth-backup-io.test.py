import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

script = Path(__file__).with_name("growth-backup-io.py")
spec = importlib.util.spec_from_file_location("backup_io", script)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class BackupIOTest(unittest.TestCase):
    def test_busy_disk_waits_then_resumes(self):
        with patch.object(guard, "pressure", side_effect=["I/O 繁忙", None]), \
                patch.object(guard.time, "sleep") as sleep:
            guard.wait_ready()
            sleep.assert_called_once_with(2)

    def test_sustained_pressure_returns_busy(self):
        with patch.object(guard, "pressure", return_value="I/O 繁忙"), \
                patch.object(guard.time, "monotonic", side_effect=[0, 31]), \
                patch.object(sys, "stderr", new_callable=io.StringIO) as stderr:
            with self.assertRaises(SystemExit) as result:
                guard.wait_ready()
            self.assertEqual(result.exception.code, 75)
            self.assertIn("GROWTH_ARCHIVE_BUSY", stderr.getvalue().splitlines())

    def test_foreground_lease_allows_rate_limited_content_and_propagates_failure(self):
        with tempfile.TemporaryDirectory() as root:
            leases = Path(root, "runtime-interactive-workloads")
            leases.mkdir()
            (leases / "handbook").write_text("running")
            env = dict(os.environ, GROWTH_STORE_DIR=root)
            command = [sys.executable, str(script), "--stream", sys.executable, "-c"]
            start = time.monotonic()
            result = subprocess.run(command + ["import sys;sys.stdout.buffer.write(b'x' * 1048576)"],
                                    capture_output=True, env=env, check=True)
            self.assertEqual(result.stdout, b"x" * 1048576)
            self.assertGreaterEqual(time.monotonic() - start, 0.24)
            self.assertEqual(subprocess.run(command + ["raise SystemExit(7)"], env=env).returncode, 7)


if __name__ == "__main__":
    unittest.main()
