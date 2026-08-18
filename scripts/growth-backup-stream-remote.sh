#!/bin/sh

# GitHub Growth 冷备的 Fly 端流式读取器。长传输必须在同一个 SSH 会话内检查
# 前台任务；禁止从 Runner 另开 SSH 探针，否则会与正在传输的连接争抢资源并误杀自己。
set -eu

ROOT="${GROWTH_STORE_DIR:-/data/growth}"
INTERACTIVE_DIR="$ROOT/runtime-interactive-workloads"
mode="${1:-}"

has_interactive_workload() {
  mkdir -p "$INTERACTIVE_DIR"
  find "$INTERACTIVE_DIR" -type f -mmin +2 -delete 2>/dev/null || true
  test -n "$(find "$INTERACTIVE_DIR" -type f -mmin -2 -print -quit 2>/dev/null)"
}

kill_tree() {
  target_pid="$1"
  children=$(pgrep -P "$target_pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child"
  done
  kill -TERM "$target_pid" 2>/dev/null || true
}

run_monitored() {
  if has_interactive_workload; then
    echo "前台平台任务运行中，冷备流式读取主动让行" >&2
    exit 75
  fi
  "$@" &
  command_pid=$!
  while kill -0 "$command_pid" 2>/dev/null; do
    # 两秒轮询兼顾前台抢占速度，并避免短命令完成后仍无谓等待十秒。
    sleep 2
    kill -0 "$command_pid" 2>/dev/null || break
    if has_interactive_workload; then
      echo "前台平台任务出现，中止当前冷备流式读取" >&2
      kill_tree "$command_pid"
      sleep 1
      kill -KILL "$command_pid" 2>/dev/null || true
      wait "$command_pid" 2>/dev/null || true
      exit 75
    fi
  done
  wait "$command_pid"
}

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
    run_monitored nice -n 15 dd if="$source_file" bs="$block_bytes" skip="$skip_blocks" count="$count_blocks" status=none
    ;;
  stream-directory)
    dir="${2:-}"
    case "$dir" in platforms|history-ledger) ;; *) echo "非法 Growth 目录" >&2; exit 64 ;; esac
    if [ -d "$ROOT/$dir" ]; then
      run_monitored nice -n 15 tar -C "$ROOT" -czf - "$dir"
    fi
    ;;
  *)
    echo "用法: $0 {stream-file PATH BLOCK_BYTES SKIP_BLOCKS COUNT_BLOCKS|stream-directory DIR}" >&2
    exit 64
    ;;
esac
