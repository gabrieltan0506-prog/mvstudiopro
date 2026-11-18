#!/bin/sh

# 固定快照允许与前台任务并行；子进程由限速读取器管理。
set -eu
ROOT="${GROWTH_STORE_DIR:-/data/growth}"
mode="${1:-}"
guard=scripts/growth-backup-io.py
[ -f "$guard" ] || guard=/app/scripts/growth-backup-io.py

validate_growth_path() {
  case "$1" in
    *..*) echo "非法 Growth 读取路径" >&2; exit 64 ;;
    "$ROOT"/backups/current-batches/*/platform-current-*.current.json.gz) ;;
    *) echo "非法 Growth 读取路径" >&2; exit 64 ;;
  esac
}

case "$mode" in
  stream-file)
    source_file="${2:-}"
    block_bytes="${3:-}"
    skip_blocks="${4:-}"
    count_blocks="${5:-}"
    validate_growth_path "$source_file"
    case "$block_bytes:$skip_blocks:$count_blocks" in
      :*|*::*|*:) echo "缺少分片参数" >&2; exit 64 ;;
      *[!0-9:]*) echo "非法分片参数" >&2; exit 64 ;;
    esac
    if [ "$block_bytes" -le 0 ] || [ "$count_blocks" -le 0 ]; then
      echo "非法分片大小" >&2
      exit 64
    fi
    exec python3 "$guard" --stream dd if="$source_file" bs="$block_bytes" skip="$skip_blocks" count="$count_blocks" status=none
    ;;
  stream-directory)
    dir="${2:-}"
    case "$dir" in platforms|history-ledger|paid-research/guaikei) ;; *) echo "非法 Growth 目录" >&2; exit 64 ;; esac
    batch="${3:-}"
    case "$batch" in ''|.|..|*[!A-Za-z0-9_-]*) echo "非法快照批次" >&2; exit 64 ;; esac
    snapshot="$ROOT/backups/current-batches/$batch/directories"
    [ -d "$snapshot/$dir" ] || { echo "快照目录缺失" >&2; exit 1; }
    [ ! -L "$snapshot/$dir" ] || exit 64
    # 版本名与当前回执可共享 inode；传输包必须逐文件携带内容，恢复校验继续拒绝链接。
    exec python3 "$guard" --stream tar --hard-dereference -C "$snapshot" -czf - "$dir"
    ;;
  *)
    echo "用法: $0 {stream-file PATH BLOCK_BYTES SKIP_BLOCKS COUNT_BLOCKS|stream-directory DIR BATCH}" >&2
    exit 64
    ;;
esac
