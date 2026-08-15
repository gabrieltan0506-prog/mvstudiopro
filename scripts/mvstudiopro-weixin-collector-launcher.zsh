#!/bin/zsh

# launchd 只负责监督这个包装进程；采集令牌在启动时从登录用户 Keychain 读取，
# 不写入脚本、plist、日志或临时文件。
set -u
setopt NO_BG_NICE
umask 077

readonly collector_repo_dir="${0:A:h:h}"
readonly collector_lock_dir="/private/tmp/mvstudiopro-weixin-channels-collector.lock"
readonly collector_pid_file="${collector_lock_dir}/launcher.pid"
readonly collector_child_restart_request="/private/tmp/mvstudiopro-weixin-channels-child-restart.request"
readonly collector_keychain_service="mvstudiopro-weixin-channels-collector"
readonly collector_server="https://api.mvstudiopro.com"

collector_child_pid=""
collector_raw_worker_pid=""
collector_owns_lock=false
collector_stopping=false

collector_cleanup() {
  trap - EXIT HUP INT TERM
  if [[ -n "${collector_child_pid}" ]] && /bin/kill -0 "${collector_child_pid}" 2>/dev/null; then
    /bin/kill -TERM "${collector_child_pid}" 2>/dev/null || true
    wait "${collector_child_pid}" 2>/dev/null || true
  fi
  if [[ -n "${collector_raw_worker_pid}" ]] && /bin/kill -0 "${collector_raw_worker_pid}" 2>/dev/null; then
    /bin/kill -TERM "${collector_raw_worker_pid}" 2>/dev/null || true
    wait "${collector_raw_worker_pid}" 2>/dev/null || true
  fi
  if [[ "${collector_owns_lock}" == true ]]; then
    local recorded_pid=""
    [[ -f "${collector_pid_file}" ]] && recorded_pid="$(<"${collector_pid_file}")"
    if [[ "${recorded_pid}" == "$$" ]]; then
      /bin/rm -f "${collector_pid_file}"
      /bin/rmdir "${collector_lock_dir}" 2>/dev/null || true
    fi
  fi
}

collector_forward_signal() {
  collector_stopping=true
  if [[ -n "${collector_child_pid}" ]] && /bin/kill -0 "${collector_child_pid}" 2>/dev/null; then
    /bin/kill -TERM "${collector_child_pid}" 2>/dev/null || true
  fi
  if [[ -n "${collector_raw_worker_pid}" ]] && /bin/kill -0 "${collector_raw_worker_pid}" 2>/dev/null; then
    /bin/kill -TERM "${collector_raw_worker_pid}" 2>/dev/null || true
  fi
}

if ! /bin/mkdir "${collector_lock_dir}" 2>/dev/null; then
  existing_pid=""
  [[ -f "${collector_pid_file}" ]] && existing_pid="$(<"${collector_pid_file}")"
  if [[ "${existing_pid}" == <-> ]] && /bin/kill -0 "${existing_pid}" 2>/dev/null; then
    print -u2 -- "weixin_channels_collector_already_running:${existing_pid}"
    # 临时重复启动属于可恢复失败；launchd 会在原进程结束后继续尝试。
    exit 75
  fi
  /bin/rm -f "${collector_pid_file}"
  if ! /bin/rmdir "${collector_lock_dir}" 2>/dev/null || ! /bin/mkdir "${collector_lock_dir}" 2>/dev/null; then
    print -u2 -- "weixin_channels_collector_lock_unavailable"
    exit 75
  fi
fi

collector_owns_lock=true
print -r -- "$$" > "${collector_pid_file}"
trap collector_cleanup EXIT
trap collector_forward_signal HUP INT TERM

# 目录锁约束所有新版 launcher；额外检查旧 launcher 或人工探针遗留的 pool，
# 防止切换 plist 时短暂出现第二个 Node 采集进程。
if /usr/bin/pgrep -f '[s]cripts/weixin-channels-capture.mts.*--pool' >/dev/null 2>&1; then
  print -u2 -- "weixin_channels_collector_unmanaged_pool_already_running"
  exit 75
fi

collector_account="$(/usr/bin/id -un)" || exit 78
collector_secret="$(/usr/bin/security find-generic-password \
  -a "${collector_account}" \
  -s "${collector_keychain_service}" \
  -w 2>/dev/null)" || exit 78
if [[ -z "${collector_secret}" ]]; then
  print -u2 -- "weixin_channels_collector_keychain_token_empty"
  exit 78
fi

export WEIXIN_CHANNELS_COLLECTOR_TOKEN="${collector_secret}"
export PATH="/Users/tangenjie/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
unset collector_secret

collector_pnpm="$(command -v pnpm 2>/dev/null)" || exit 69
cd "${collector_repo_dir}" || exit 72

collector_start_raw_worker() {
  if [[ -n "${collector_raw_worker_pid}" ]] \
    && /bin/kill -0 "${collector_raw_worker_pid}" 2>/dev/null; then
    return 0
  fi
  # OCR、去重和网络批传降到后台优先级，避免与前台双窗截图/键鼠争抢 CPU。
  /usr/bin/nice -n 10 "${collector_pnpm}" exec tsx \
    scripts/weixin-channels-raw-worker.mts \
    --server="${collector_server}" &
  collector_raw_worker_pid=$!
  /bin/sleep 0.2
  if ! /bin/kill -0 "${collector_raw_worker_pid}" 2>/dev/null; then
    wait "${collector_raw_worker_pid}" 2>/dev/null || true
    collector_raw_worker_pid=""
    print -u2 -- "weixin_channels_raw_worker_start_failed"
    return 1
  fi
}

# 离线 OCR/去重/批传是独立常驻 worker。UI 子进程每二十分钟退出一次时，
# worker 继续处理刚封存批次，因此不会用 OCR 或上传阻塞下一轮采集。
collector_start_raw_worker || exit 75

# 正式入口只允许“恰好两窗、同一微信 PID”的受限自动绑定。网页从停采切到
# 开采时强制重新校准；正常二十分钟轮换只复用绑定当前 windowId/PID 的相对点。
collector_reuse_calibration=false
while true; do
  collector_start_raw_worker || exit 75
  collector_capture_args=(
    exec tsx
    scripts/weixin-channels-capture.mts
    --pool
    --server="${collector_server}"
    --auto-bind-exact-two-windows
    --calibrate-search-buttons
    --raw-harvest
    --raw-offline-worker-managed
    --supervise-web-toggle
  )
  if [[ "${collector_reuse_calibration}" == true ]]; then
    collector_capture_args+=(--reuse-search-calibration)
  fi
  /usr/bin/caffeinate -dimsu "${collector_pnpm}" "${collector_capture_args[@]}" &
  collector_child_pid=$!
  wait "${collector_child_pid}"
  collector_status=$?
  collector_child_pid=""
  if [[ "${collector_stopping}" == true ]]; then
    exit 0
  fi
  if [[ -f "${collector_child_restart_request}" ]]; then
    /bin/rm -f "${collector_child_restart_request}"
    print -- "weixin_channels_collector_child_watchdog_restart"
    collector_reuse_calibration=true
    continue
  fi
  if [[ "${collector_status}" -eq 76 ]]; then
    print -- "weixin_channels_collector_child_rotating"
    collector_reuse_calibration=true
    continue
  fi
  exit "${collector_status}"
done
