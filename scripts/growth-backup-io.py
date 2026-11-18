"""在正式卷上测量压力，对快照读取限速；所有诊断写 stderr。"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

STORE = Path(os.environ.get("GROWTH_STORE_DIR", "/data/growth"))
CHUNK = 64 * 1024
BYTES_PER_SECOND = 4 * 1024 * 1024


def pressure():
    volume = os.statvfs(STORE)
    if volume.f_bavail * volume.f_frsize < 1024 * 1024:
        return "磁盘可用空间不足 1 MiB"
    for file in (Path("/sys/fs/cgroup/io.pressure"), Path("/proc/pressure/io")):
        if file.exists():
            for row in file.read_text().splitlines():
                fields = row.split()
                if fields[0] == "full":
                    avg10 = float(dict(field.split("=") for field in fields[1:])["avg10"])
                    return "I/O 完全阻塞时间占比达到 10%" if avg10 >= 10 else None
            raise ValueError("I/O 压力指标缺少 full 记录")
    return None  # 部分内核没有 PSI；仍使用空间检查、低优先级和速率上限。


def wait_ready():
    deadline = time.monotonic() + 30
    while True:
        reason = pressure()
        if not reason:
            return
        if time.monotonic() >= deadline:
            print(reason, file=sys.stderr)
            print("GROWTH_ARCHIVE_BUSY", file=sys.stderr)
            raise SystemExit(75)
        time.sleep(2)


def stream(command):
    wait_ready()
    os.nice(10)
    child = subprocess.Popen(command, stdout=subprocess.PIPE, start_new_session=True)
    try:
        next_check = 0
        while True:
            now = time.monotonic()
            if now >= next_check:
                wait_ready()
                next_check = time.monotonic() + 2
            start = time.monotonic()
            block = child.stdout.read(CHUNK)
            if not block:
                break
            sys.stdout.buffer.write(block)
            sys.stdout.buffer.flush()
            time.sleep(max(0, len(block) / BYTES_PER_SECOND - (time.monotonic() - start)))
        return child.wait()
    finally:
        child.stdout.close()
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        wait_ready()
    elif sys.argv[1:2] == ["--stream"] and len(sys.argv) > 2:
        def interrupted(signum, frame):
            raise SystemExit(128 + signum)

        for sig in (signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, interrupted)
        sys.exit(stream(sys.argv[2:]))
    else:
        sys.exit(64)
