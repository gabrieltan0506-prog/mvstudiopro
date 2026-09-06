#!/bin/sh
# 只在 Fly 运行：数字不允许由 GitHub runner 的 /data 或本地变量替代。
set -eu
root="${GROWTH_STORE_DIR:-/data/growth}"
volume="${GROWTH_VOLUME_DIR:-/data}"
test -d "$root"
test -d "$volume"
size_dir() {
  if [ -d "$1" ]; then du -sb "$1" | awk '{print $1}'; else echo 0; fi
}
current=0
if [ -f "$root/current.json" ]; then current=$(stat -c%s "$root/current.json"); fi
platforms=$(size_dir "$root/platforms")
platform_current=$(size_dir "$root/platform-current")
archive=$(size_dir "$root/archive")
largest=$(find "$root" -maxdepth 2 -type f -printf '%s\n' | sort -nr | head -n 1)
capacity=$(df -B1 "$volume")
total=$(printf '%s\n' "$capacity" | awk 'NR==2{print $2}')
avail=$(printf '%s\n' "$capacity" | awk 'NR==2{print $4}')
for value in "$current" "$platforms" "$platform_current" "$archive" "${largest:-0}" "$total" "$avail"; do
  case "$value" in ''|*[!0-9]*) echo '磁盘探针未返回有效数字' >&2; exit 65 ;; esac
done
test "$total" -gt 0
printf 'CURRENT_BYTES=%s\nPLATFORMS_BYTES=%s\nPLATFORM_CURRENT_BYTES=%s\nARCHIVE_BYTES=%s\nLARGEST_FILE_BYTES=%s\nTOTAL_BYTES=%s\nAVAILABLE_BYTES=%s\n' "$current" "$platforms" "$platform_current" "$archive" "${largest:-0}" "$total" "$avail"
