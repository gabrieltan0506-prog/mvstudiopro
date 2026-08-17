#!/bin/zsh

# 将已验证、已提交的仓库版本同步到本机 launchd 使用的固定 runtime。
# 不复制 .git、.env、用户数据或 raw spool；不删除 runtime 中的历史文件。
set -eu
setopt NO_BG_NICE
umask 077

readonly runtime_sync_file="${0:A}"
readonly runtime_source_dir="${runtime_sync_file:h:h}"
readonly runtime_target_dir="/private/tmp/mvstudiopro-weixin-channels"
readonly runtime_lock_dir="/private/tmp/mvstudiopro-weixin-channels-runtime-sync.lock"
readonly runtime_collector_label="com.mvstudiopro.weixin-channels-collector"
readonly runtime_watchdog_label="com.mvstudiopro.weixin-channels-watchdog"
readonly runtime_launchd_domain="gui/$(/usr/bin/id -u)"
readonly runtime_manifest="${runtime_target_dir}/.mvstudiopro-weixin-runtime.json"

runtime_fail() {
  print -u2 -- "$1"
  exit 1
}

runtime_validate_source() {
  for runtime_required in \
    scripts/mvstudiopro-weixin-collector-launcher.zsh \
    scripts/mvstudiopro-weixin-collector-watchdog.zsh \
    scripts/weixin-channels-capture.mts \
    scripts/weixin-channels-raw-worker.mts \
    scripts/install-weixin-channels-launchd.zsh \
    scripts/install-weixin-channels-watchdog.zsh \
    shared/weixinChannelsRules.ts \
    package.json \
    tsconfig.json; do
    [[ -f "${runtime_source_dir}/${runtime_required}" ]] \
      || runtime_fail "weixin_channels_runtime_source_missing:${runtime_required}"
  done
  /bin/zsh -f -o NO_BG_NICE -n "${runtime_source_dir}/scripts/mvstudiopro-weixin-collector-launcher.zsh" \
    || runtime_fail "weixin_channels_runtime_launcher_invalid"
  /bin/zsh -f -o NO_BG_NICE -n "${runtime_source_dir}/scripts/mvstudiopro-weixin-collector-watchdog.zsh" \
    || runtime_fail "weixin_channels_runtime_watchdog_invalid"
  /bin/zsh -f -o NO_BG_NICE -n "${runtime_sync_file}" \
    || runtime_fail "weixin_channels_runtime_sync_invalid"
  /usr/bin/git -C "${runtime_source_dir}" rev-parse --verify HEAD >/dev/null 2>&1 \
    || runtime_fail "weixin_channels_runtime_source_commit_missing"
}

runtime_validate_target() {
  [[ "${runtime_target_dir}" == "/private/tmp/mvstudiopro-weixin-channels" ]] \
    || runtime_fail "weixin_channels_runtime_target_invalid"
  [[ ! -L "${runtime_target_dir}" ]] || runtime_fail "weixin_channels_runtime_target_symlink_forbidden"
  if [[ -e "${runtime_target_dir}" ]]; then
    [[ "$(/usr/bin/stat -f %u "${runtime_target_dir}")" == "$(/usr/bin/id -u)" ]] \
      || runtime_fail "weixin_channels_runtime_target_owner_invalid"
  fi
}

runtime_mode="${1:---check-source}"
runtime_validate_source
runtime_validate_target

case "${runtime_mode}" in
  --check-source)
    print -- "weixin_channels_runtime_sync_source_ok"
    ;;
  --install)
    [[ -z "$(/usr/bin/git -C "${runtime_source_dir}" status --porcelain --untracked-files=no)" ]] \
      || runtime_fail "weixin_channels_runtime_source_dirty"
    [[ -e "${runtime_target_dir}/node_modules" ]] \
      || runtime_fail "weixin_channels_runtime_dependencies_missing"
    /bin/mkdir "${runtime_lock_dir}" 2>/dev/null \
      || runtime_fail "weixin_channels_runtime_sync_already_running"
    trap '/bin/rmdir "${runtime_lock_dir}" 2>/dev/null || true' EXIT HUP INT TERM

    for runtime_label in "${runtime_watchdog_label}" "${runtime_collector_label}"; do
      if /bin/launchctl print "${runtime_launchd_domain}/${runtime_label}" >/dev/null 2>&1; then
        /bin/launchctl bootout "${runtime_launchd_domain}/${runtime_label}" \
          || runtime_fail "weixin_channels_runtime_bootout_failed:${runtime_label}"
      fi
    done

    /bin/mkdir -p "${runtime_target_dir}"
    for runtime_tree in scripts shared server; do
      /usr/bin/rsync -a "${runtime_source_dir}/${runtime_tree}/" "${runtime_target_dir}/${runtime_tree}/" \
        || runtime_fail "weixin_channels_runtime_copy_failed:${runtime_tree}"
    done
    for runtime_root_file in package.json tsconfig.json; do
      /usr/bin/install -m 600 \
        "${runtime_source_dir}/${runtime_root_file}" \
        "${runtime_target_dir}/${runtime_root_file}" \
        || runtime_fail "weixin_channels_runtime_copy_failed:${runtime_root_file}"
    done

    for runtime_verify in \
      scripts/mvstudiopro-weixin-collector-launcher.zsh \
      scripts/mvstudiopro-weixin-collector-watchdog.zsh \
      scripts/weixin-channels-capture.mts \
      scripts/weixin-channels-raw-worker.mts \
      shared/weixinChannelsRules.ts; do
      /usr/bin/cmp -s \
        "${runtime_source_dir}/${runtime_verify}" \
        "${runtime_target_dir}/${runtime_verify}" \
        || runtime_fail "weixin_channels_runtime_verify_failed:${runtime_verify}"
    done

    runtime_commit="$(/usr/bin/git -C "${runtime_source_dir}" rev-parse HEAD)"
    runtime_installed_at="$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
    print -r -- "{\"commit\":\"${runtime_commit}\",\"installedAt\":\"${runtime_installed_at}\"}" \
      > "${runtime_manifest}"
    /bin/chmod 600 "${runtime_manifest}"

    "${runtime_target_dir}/scripts/install-weixin-channels-launchd.zsh" --install \
      || runtime_fail "weixin_channels_runtime_collector_install_failed"
    "${runtime_target_dir}/scripts/install-weixin-channels-watchdog.zsh" --install \
      || runtime_fail "weixin_channels_runtime_watchdog_install_failed"
    print -- "weixin_channels_runtime_installed:${runtime_commit}"
    ;;
  *)
    runtime_fail "usage: ${runtime_sync_file} --check-source|--install"
    ;;
esac
