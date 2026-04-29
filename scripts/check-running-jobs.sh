#!/usr/bin/env bash
# 部署前必查脚本：列出 Fly 持久卷上所有正在跑的 deep-research 任务。
#
# ⚠️ 任何一次会触发 fly deploy / fly machine restart 的操作（推送 main、
#    手动 fly deploy、Cloud Run 部署等）都必须先跑这个脚本。
#    如果有 status=planning/running/awaiting_* 的任务，就先 hold 住，
#    等到任务自然结束 / 主动失败 / 用户授权关闭，再做部署。
#
# 烧的是 Google deep-research-max API 的算力费 + 用户积分，
# 一次重启 = 一次性整个任务作废。— 不可重来，不可省。
#
# 用法：
#   bash scripts/check-running-jobs.sh
#   # 退出码 0 = 安全部署；2 = 有任务在跑，必须等。
set -euo pipefail

APP="${FLY_APP:-mvstudiopro}"

echo "🔍 查询 Fly app=$APP 上的 deep-research 任务状态..."
echo ""

JOBS_RAW=$(flyctl ssh console -a "$APP" -C 'find /data/growth/deep-research -maxdepth 1 -type f -name "*.json" -printf "%p\n"' 2>/dev/null | grep -E "^/data/" || true)

if [[ -z "$JOBS_RAW" ]]; then
  echo "✅ 持久卷上没有任何 deep-research 任务文件，可以安全部署。"
  exit 0
fi

# 拉每个 job 的 status + lastHeartbeatAt
ACTIVE_COUNT=0
ACTIVE_LIST=""
while IFS= read -r jobfile; do
  [[ -z "$jobfile" ]] && continue
  CONTENT=$(flyctl ssh console -a "$APP" -C "cat $jobfile" 2>/dev/null || echo "")
  STATUS=$(echo "$CONTENT" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("status",""))' 2>/dev/null || echo "")
  HEARTBEAT=$(echo "$CONTENT" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("lastHeartbeatAt",""))' 2>/dev/null || echo "")
  JOB_ID=$(basename "$jobfile" .json)
  case "$STATUS" in
    planning|running|awaiting_review|awaiting_plan_approval|queued|dispatched)
      ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
      ACTIVE_LIST="$ACTIVE_LIST\n  • $JOB_ID  status=$STATUS  heartbeat=$HEARTBEAT"
      ;;
  esac
done <<< "$JOBS_RAW"

if (( ACTIVE_COUNT > 0 )); then
  echo "🚨 发现 $ACTIVE_COUNT 个正在跑的任务！部署会全部杀掉，烧 Google API 算力。"
  echo -e "$ACTIVE_LIST"
  echo ""
  echo "处理建议："
  echo "  1) 等任务自然结束（normal 跑完会变 completed/failed）"
  echo "  2) 跟用户确认是否可以强行打断（如果是孤儿/已知挂死）"
  echo "  3) 用 SSH 手动改 job 文件 status=failed 关闭它再部署"
  exit 2
fi

echo "✅ 没有正在跑的任务，可以安全部署。"
exit 0
