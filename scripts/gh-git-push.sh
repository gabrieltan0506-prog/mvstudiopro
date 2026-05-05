#!/usr/bin/env bash
# 用 gh 的 OAuth（含 workflow 文件推送权限）推送，跳过 macOS 钥匙圈里抢先使用的旧 PAT。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

command -v git >/dev/null 2>&1 || {
  echo "error: git 未安装" >&2
  exit 127
}

command -v gh >/dev/null 2>&1 || {
  echo "error: 未安装 gh，请从 https://cli.github.com 安装并执行 gh auth login" >&2
  exit 127
}

gh auth status >/dev/null 2>&1 || {
  echo "error: gh 未登录 github.com，请运行: gh auth login" >&2
  exit 1
}

tmp="$(mktemp)"
cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

cat >"$tmp" <<'EOF'
[credential]
	helper =
[credential "https://github.com"]
	helper =
	helper = "!/usr/bin/env gh auth git-credential"
EOF

# 忽略系统自带的 osxkeychain 优先返回旧 ghp_* 的行为，仅对用户级配置写入上述 credential链
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_GLOBAL="$tmp"
export GIT_TERMINAL_PROMPT=0

git push "$@"
