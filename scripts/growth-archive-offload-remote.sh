#!/bin/sh

# 在 Fly 内执行的 archive 冷备辅助脚本。源码由 GitHub Actions 通过 stdin 传入，
# 不依赖 Fly 当前部署版本；所有源目录读取/删除都与采集共用同一跨进程 lease。
set -eu

ROOT="${GROWTH_STORE_DIR:-/data/growth}"
ARCHIVE_ROOT="$ROOT/archive"
SNAPSHOT_PARENT="$ROOT/backups/archive-offload"
COLLECTION_LOCK="$ROOT/.growth-platform-collection.lock"
INTERACTIVE_DIR="$ROOT/runtime-interactive-workloads"
LOCK_STALE_MINUTES=15

mode="${1:-}"
batch_id="${2:-}"

case "$batch_id" in
  ""|*[!0-9A-Za-z._-]*)
    echo "非法 archive offload batch id" >&2
    exit 64
    ;;
esac

snapshot_root="$SNAPSHOT_PARENT/$batch_id"
lock_owner="github-growth-archive:$batch_id:$mode"
lock_acquired=false
heartbeat_pid=""

has_interactive_workload() {
  mkdir -p "$INTERACTIVE_DIR"
  find "$INTERACTIVE_DIR" -type f -mmin +2 -delete 2>/dev/null || true
  test -n "$(find "$INTERACTIVE_DIR" -type f -mmin -2 -print -quit 2>/dev/null)"
}

release_collection_lease() {
  if [ -n "$heartbeat_pid" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
    heartbeat_pid=""
  fi
  if [ "$lock_acquired" = "true" ] && [ "$(cat "$COLLECTION_LOCK" 2>/dev/null || true)" = "$lock_owner" ]; then
    rm -f -- "$COLLECTION_LOCK"
  fi
  lock_acquired=false
}

acquire_collection_lease() {
  mkdir -p "$ROOT"
  if has_interactive_workload; then
    echo "前台交互任务运行中，archive offload 主动让行" >&2
    exit 42
  fi
  if [ -e "$COLLECTION_LOCK" ]; then
    if find "$COLLECTION_LOCK" -mmin "+$LOCK_STALE_MINUTES" -print -quit 2>/dev/null | grep -q .; then
      rm -f -- "$COLLECTION_LOCK"
    else
      echo "采集 lease 正在使用，archive offload 主动让行" >&2
      exit 43
    fi
  fi
  if ! (set -C; umask 077; printf '%s' "$lock_owner" > "$COLLECTION_LOCK") 2>/dev/null; then
    echo "采集 lease 竞争失败，archive offload 主动让行" >&2
    exit 43
  fi
  lock_acquired=true
  if has_interactive_workload; then
    release_collection_lease
    echo "取得 lease 后检测到前台交互任务，archive offload 主动让行" >&2
    exit 42
  fi
  (
    while sleep 30; do
      if [ "$(cat "$COLLECTION_LOCK" 2>/dev/null || true)" != "$lock_owner" ]; then
        exit 0
      fi
      touch "$COLLECTION_LOCK"
    done
  ) &
  heartbeat_pid=$!
}

validate_dir_name() {
  case "$1" in
    ""|.|..|*[!0-9A-Za-z._-]*)
      echo "非法 archive 目录名: $1" >&2
      return 1
      ;;
  esac
}

metadata_fingerprint() {
  target="$1"
  if [ ! -d "$target" ]; then
    printf '%s\n' "missing"
    return 0
  fi
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.resolve(process.argv[1]);
    const rows = [];
    function visit(dir, relativeDir = "") {
      for (const name of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, "en"))) {
        const absolute = path.join(dir, name);
        const relative = path.posix.join(relativeDir, name);
        const stat = fs.lstatSync(absolute);
        const type = stat.isDirectory() ? "d" : stat.isFile() ? "f" : stat.isSymbolicLink() ? "l" : "o";
        rows.push([type, relative, stat.size, Math.trunc(stat.mtimeMs), stat.mode, type === "l" ? fs.readlinkSync(absolute) : ""]);
        if (type === "d") visit(absolute, relative);
      }
    }
    visit(root);
    process.stdout.write(`${crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex")}\n`);
  ' "$target"
}

prepare_snapshot() {
  acquire_collection_lease
  snapshot_next="$snapshot_root.next"
  trap 'rm -rf -- "$snapshot_next"; release_collection_lease' EXIT HUP INT TERM
  if [ ! -d "$ARCHIVE_ROOT" ]; then
    exit 0
  fi

  mkdir -p "$SNAPSHOT_PARENT"
  # workflow 被强制取消时 always 清理可能来不及执行；下个串行批次只回收旧临时快照，
  # 该目录全部是 hardlink 副本，绝不触碰 ARCHIVE_ROOT 源目录。
  find "$SNAPSHOT_PARENT" -mindepth 1 -maxdepth 1 -type d -mmin +180 -exec rm -rf -- {} + 2>/dev/null || true
  if [ -f "$snapshot_root/snapshot.tsv" ]; then
    # SSH 在远端原子 mv 完成后断线时，本地可安全复用同一批次，避免覆盖或重复快照。
    cat "$snapshot_root/snapshot.tsv"
    return 0
  fi
  if [ -e "$snapshot_next" ]; then
    rm -rf -- "$snapshot_next"
  fi
  if [ -e "$snapshot_root" ]; then
    echo "archive offload 快照批次已存在，拒绝覆盖: $batch_id" >&2
    exit 65
  fi
  mkdir "$snapshot_next"

  all_dirs="$snapshot_next/.all-dirs"
  date_dirs="$snapshot_next/.date-dirs"
  selected_dirs="$snapshot_next/.selected-dirs"
  find "$ARCHIVE_ROOT" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | LC_ALL=C sort > "$all_dirs"
  grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' "$all_dirs" | LC_ALL=C sort > "$date_dirs" || true
  awk '{ lines[NR]=$0 } END { for (i=1; i<=NR-2; i++) print lines[i] }' "$date_dirs" > "$selected_dirs"
  grep -v -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' "$all_dirs" >> "$selected_dirs" || true

  available_bytes=$(df -Pk "$ROOT" | awk 'NR==2{printf "%.0f\n", $4 * 1024}')
  target_bytes=$((1200 * 1024 * 1024))
  if [ ! -s "$selected_dirs" ] && [ -s "$date_dirs" ] && [ "${available_bytes:-0}" -lt "$target_bytes" ]; then
    needed_bytes=$((target_bytes - available_bytes))
    selected_count=0
    : > "$selected_dirs"
    while IFS= read -r dir; do
      validate_dir_name "$dir"
      printf '%s\n' "$dir" >> "$selected_dirs"
      dir_bytes=$(du -sk "$ARCHIVE_ROOT/$dir" 2>/dev/null | awk '{printf "%.0f\n", $1 * 1024}')
      needed_bytes=$((needed_bytes - ${dir_bytes:-0}))
      selected_count=$((selected_count + 1))
      if [ "$needed_bytes" -le 0 ] && [ "$selected_count" -ge 2 ]; then
        break
      fi
    done < "$date_dirs"
  fi
  LC_ALL=C sort -u "$selected_dirs" -o "$selected_dirs"

  plan="$snapshot_next/snapshot.tsv"
  : > "$plan"
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    validate_dir_name "$dir"
    if has_interactive_workload; then
      echo "创建 archive 快照时出现前台交互任务，本轮让行" >&2
      exit 42
    fi
    cp -al -- "$ARCHIVE_ROOT/$dir" "$snapshot_next/$dir"
    fingerprint=$(metadata_fingerprint "$snapshot_next/$dir")
    bytes=$(du -sk "$snapshot_next/$dir" 2>/dev/null | awk '{printf "%.0f\n", $1 * 1024}')
    printf '%s\t%s\t%s\n' "$dir" "$fingerprint" "${bytes:-0}" >> "$plan"
  done < "$selected_dirs"

  rm -f -- "$all_dirs" "$date_dirs" "$selected_dirs"
  mv "$snapshot_next" "$snapshot_root"
  cat "$snapshot_root/snapshot.tsv"
}

stream_bundle() {
  dir="${1:-}"
  validate_dir_name "$dir"
  if has_interactive_workload; then
    echo "前台交互任务运行中，archive 压缩主动让行" >&2
    exit 42
  fi
  source_dir="$snapshot_root/$dir"
  if [ ! -d "$source_dir" ]; then
    echo "archive 快照目录不存在: $dir" >&2
    exit 66
  fi

  # 压缩只读 lease 内创建的 hardlink 快照；nice/ionice 让实时采集优先使用 CPU 与磁盘。
  if command -v ionice >/dev/null 2>&1 && ionice -c 3 true >/dev/null 2>&1; then
    nice -n 19 ionice -c 3 tar -C "$snapshot_root" -cf - -- "$dir" | nice -n 19 gzip -1
  else
    nice -n 19 tar -C "$snapshot_root" -cf - -- "$dir" | nice -n 19 gzip -1
  fi
}

delete_verified_source() {
  dir="${1:-}"
  expected_fingerprint="${2:-}"
  validate_dir_name "$dir"
  if [ "${#expected_fingerprint}" -ne 64 ]; then
    echo "非法源指纹: $dir" >&2
    exit 64
  fi
  case "$expected_fingerprint" in
    *[!0-9a-f]*) echo "非法源指纹: $dir" >&2; exit 64 ;;
  esac
  acquire_collection_lease
  trap 'release_collection_lease' EXIT HUP INT TERM
  source_dir="$ARCHIVE_ROOT/$dir"
  if [ ! -e "$source_dir" ]; then
    rm -rf -- "$snapshot_root/$dir"
    return 0
  fi
  current_fingerprint=$(metadata_fingerprint "$source_dir")
  if [ "$current_fingerprint" != "$expected_fingerprint" ]; then
    echo "archive 源目录在快照后发生变化，拒绝删除: $dir" >&2
    exit 45
  fi
  rm -rf -- "$source_dir"
  rm -rf -- "$snapshot_root/$dir"
}

cleanup_snapshot() {
  # 这里只清理已验证批次的临时 hardlink；不触碰 archive 源目录。
  acquire_collection_lease
  trap 'release_collection_lease' EXIT HUP INT TERM
  rm -rf -- "$snapshot_root"
}

cleanup_current_batch() {
  # batch_id 已经过严格字符校验；目标固定在 current-batches 单一批次下。
  acquire_collection_lease
  trap 'release_collection_lease' EXIT HUP INT TERM
  rm -rf -- "$ROOT/backups/current-batches/$batch_id"
}

case "$mode" in
  prepare) prepare_snapshot ;;
  bundle) stream_bundle "${3:-}" ;;
  delete) delete_verified_source "${3:-}" "${4:-}" ;;
  cleanup) cleanup_snapshot ;;
  cleanup-current-batch) cleanup_current_batch ;;
  *)
    echo "用法: $0 {prepare|bundle|delete|cleanup|cleanup-current-batch} BATCH_ID [DIR] [SOURCE_FINGERPRINT]" >&2
    exit 64
    ;;
esac
