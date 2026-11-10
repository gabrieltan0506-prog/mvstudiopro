#!/usr/bin/env bash
# 安装本机 git 钩子：每次 git push 前自动清理已完工的代理工作目录（见 scripts/agent-worktree-gc.sh）。钩子不入库，换机器/新克隆须重跑。
set -eu
HOOKS="$(git rev-parse --git-common-dir)/hooks"; mkdir -p "$HOOKS"
MARK="# agent-worktree-gc"
if ! grep -q "$MARK" "$HOOKS/pre-push" 2>/dev/null; then
  [ -f "$HOOKS/pre-push" ] || printf '#!/usr/bin/env bash\n' > "$HOOKS/pre-push"
  cat >> "$HOOKS/pre-push" <<'HOOK'
# agent-worktree-gc：推送前顺手清理已完工的代理工作目录；后台执行，不拖慢也不拦推送
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; [ -f "$ROOT/scripts/agent-worktree-gc.sh" ] && (nohup bash "$ROOT/scripts/agent-worktree-gc.sh" >/dev/null 2>&1 &)
exit 0
HOOK
  chmod +x "$HOOKS/pre-push"
fi
echo "installed $HOOKS/pre-push"
