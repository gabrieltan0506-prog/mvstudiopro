#!/bin/zsh

# 用法：
#   ./scripts/install-weixin-channels-launchd.zsh --check-source
#   ./scripts/install-weixin-channels-launchd.zsh --install
#   ./scripts/install-weixin-channels-launchd.zsh --check
set -eu
umask 077

readonly installer_file="${0:A}"
readonly launchd_label="com.mvstudiopro.weixin-channels-collector"
readonly repo_dir="${installer_file:h:h}"
readonly source_launcher="${repo_dir}/scripts/mvstudiopro-weixin-collector-launcher.zsh"
readonly source_plist="${repo_dir}/scripts/launchd/${launchd_label}.plist"
readonly target_dir="${HOME}/Library/LaunchAgents"
readonly target_plist="${target_dir}/${launchd_label}.plist"
readonly launchd_domain="gui/$(/usr/bin/id -u)"
readonly keychain_service="mvstudiopro-weixin-channels-collector"
rendered_plist="$(/usr/bin/mktemp /private/tmp/weixin-channels-launchd.XXXXXX)"
trap '/bin/rm -f "${rendered_plist}"' EXIT

fail() {
  print -u2 -- "$1"
  exit 1
}

render_plist() {
  escaped_repo_dir="${repo_dir//&/\\&}"
  escaped_repo_dir="${escaped_repo_dir//|/\\|}"
  /usr/bin/sed "s|__WEIXIN_CHANNELS_REPO_ROOT__|${escaped_repo_dir}|g" \
    "${source_plist}" > "${rendered_plist}"
}

validate_source() {
  /bin/zsh -f -o NO_BG_NICE -n "${source_launcher}" || fail "launcher_syntax_invalid"
  /bin/zsh -f -o NO_BG_NICE -n "${installer_file}" || fail "installer_syntax_invalid"
  /usr/bin/plutil -lint "${source_plist}" >/dev/null || fail "source_plist_invalid"
  /usr/bin/grep -F -- "--auto-bind-exact-two-windows" "${source_launcher}" >/dev/null \
    || fail "exact_two_window_auto_binding_missing"
  /usr/bin/grep -F -- "--calibrate-search-buttons" "${source_launcher}" >/dev/null \
    || fail "formal_search_calibration_missing"
  /usr/bin/grep -F -- "--supervise-web-toggle" "${source_launcher}" >/dev/null \
    || fail "web_toggle_supervisor_missing"
  ! /usr/bin/grep -E -- '--window-id=[0-9]+' "${source_launcher}" >/dev/null \
    || fail "hardcoded_window_id_forbidden"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :KeepAlive:SuccessfulExit' "${source_plist}")" == false ]] \
    || fail "launchd_keepalive_must_only_restart_nonzero_exit"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "${source_plist}")" \
    == "__WEIXIN_CHANNELS_REPO_ROOT__/scripts/mvstudiopro-weixin-collector-launcher.zsh" ]] \
    || fail "launchd_launcher_path_invalid"
  /usr/bin/grep -F -- 'security find-generic-password' "${source_launcher}" >/dev/null \
    || fail "keychain_lookup_missing"
  /usr/bin/grep -F -- "pgrep -f '[s]cripts/weixin-channels-capture.mts.*--pool'" "${source_launcher}" >/dev/null \
    || fail "unmanaged_pool_guard_missing"
  render_plist
  /usr/bin/plutil -lint "${rendered_plist}" >/dev/null || fail "rendered_plist_invalid"
  ! /usr/bin/grep -F -- "__WEIXIN_CHANNELS_REPO_ROOT__" "${rendered_plist}" >/dev/null \
    || fail "rendered_plist_placeholder_remaining"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "${rendered_plist}")" \
    == "${repo_dir}/scripts/mvstudiopro-weixin-collector-launcher.zsh" ]] \
    || fail "rendered_launcher_path_invalid"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "${rendered_plist}")" == "${repo_dir}" ]] \
    || fail "rendered_working_directory_invalid"
}

validate_runtime_prerequisites() {
  [[ -x "${source_launcher}" ]] || fail "launcher_not_executable"
  /usr/bin/security find-generic-password \
    -a "$(/usr/bin/id -un)" \
    -s "${keychain_service}" \
    >/dev/null 2>&1 || fail "collector_keychain_token_missing"
}

mode="${1:---check-source}"
validate_source

case "${mode}" in
  --check-source)
    print -- "weixin_channels_launchd_source_ok"
    ;;
  --install)
    validate_runtime_prerequisites
    /bin/mkdir -p "${target_dir}"
    changed=false
    if [[ ! -f "${target_plist}" ]] || ! /usr/bin/cmp -s "${rendered_plist}" "${target_plist}"; then
      /usr/bin/install -m 600 "${rendered_plist}" "${target_plist}"
      changed=true
    fi
    if /bin/launchctl print "${launchd_domain}/${launchd_label}" >/dev/null 2>&1; then
      if [[ "${changed}" == false ]]; then
        print -- "weixin_channels_launchd_already_installed"
        exit 0
      fi
      /bin/launchctl bootout "${launchd_domain}" "${target_plist}"
    fi
    /bin/launchctl bootstrap "${launchd_domain}" "${target_plist}"
    /bin/launchctl print "${launchd_domain}/${launchd_label}" >/dev/null \
      || fail "launchd_service_not_loaded"
    print -- "weixin_channels_launchd_installed"
    ;;
  --check)
    validate_runtime_prerequisites
    [[ -f "${target_plist}" ]] || fail "installed_plist_missing"
    /usr/bin/cmp -s "${rendered_plist}" "${target_plist}" || fail "installed_plist_out_of_date"
    /bin/launchctl print "${launchd_domain}/${launchd_label}" >/dev/null \
      || fail "launchd_service_not_loaded"
    print -- "weixin_channels_launchd_ok"
    ;;
  *)
    fail "usage: ${installer_file} --check-source|--install|--check"
    ;;
esac
