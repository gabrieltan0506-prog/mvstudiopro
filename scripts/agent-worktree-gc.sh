#!/usr/bin/env bash
# 代理工作目录自动清理（2026-11-10 用户要求：不能靠人工清磁盘）。
# 只删「已完工」的 git worktree：无任何未提交/未跟踪改动（node_modules 软链除外）、HEAD 已在某个远端分支上、
# 且最近 GRACE_MIN 分钟内没有文件改动（防误删刚被续派任务的目录）。主仓库目录与当前所在 worktree 永不删除。
# 用法：bash scripts/agent-worktree-gc.sh [--dry-run]；由 pre-push 钩子在每次推送时自动调用（scripts/install-agent-hooks.sh 安装）。
set -u
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
GRACE_MIN="${AGENT_WT_GC_GRACE_MIN:-30}"
MAIN="$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
[ -n "$MAIN" ] || exit 0
HERE="$(git rev-parse --show-toplevel 2>/dev/null || true)"
exec 9>"${TMPDIR:-/tmp}/agent-worktree-gc.lock"; flock -n 9 || exit 0
git -C "$MAIN" worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r WT; do
  [ "$WT" = "$MAIN" ] && continue
  [ "$WT" = "$HERE" ] && continue
  [ -d "$WT" ] || continue
  # 未提交或未跟踪改动（忽略 node_modules 软链）→ 保留
  if [ -n "$(git -C "$WT" status --porcelain 2>/dev/null | grep -v '^?? node_modules/\?$')" ]; then continue; fi
  # HEAD 未推到任何远端分支 → 保留
  HEAD_SHA="$(git -C "$WT" rev-parse HEAD 2>/dev/null)" || continue
  [ -z "$(git -C "$MAIN" rev-list -1 "$HEAD_SHA" --not --remotes 2>/dev/null)" ] || continue
  # 近期仍有文件改动（含 .git 元数据）→ 保留
  GITDIR="$(git -C "$WT" rev-parse --git-dir 2>/dev/null)"
  if [ -n "$(find "$WT" "$GITDIR" -maxdepth 2 -not -path '*/node_modules/*' -mmin "-$GRACE_MIN" -print -quit 2>/dev/null)" ]; then continue; fi
  if [ "$DRY" = 1 ]; then echo "[agent-worktree-gc] would remove $WT"; continue; fi
  git -C "$MAIN" worktree remove --force "$WT" >/dev/null 2>&1 && echo "[agent-worktree-gc] removed $WT"
done
git -C "$MAIN" worktree prune >/dev/null 2>&1
exit 0
