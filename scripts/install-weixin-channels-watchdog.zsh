#!/bin/zsh

set -eu
setopt NO_BG_NICE
umask 077

readonly watchdog_installer="${0:A}"
readonly watchdog_repo_dir="${watchdog_installer:h:h}"
readonly watchdog_label="com.mvstudiopro.weixin-channels-watchdog"
readonly watchdog_source="${watchdog_repo_dir}/scripts/mvstudiopro-weixin-collector-watchdog.zsh"
readonly watchdog_source_plist="${watchdog_repo_dir}/scripts/launchd/${watchdog_label}.plist"
readonly watchdog_target_dir="${HOME}/Library/LaunchAgents"
readonly watchdog_target_plist="${watchdog_target_dir}/${watchdog_label}.plist"
readonly watchdog_domain="gui/$(/usr/bin/id -u)"
watchdog_rendered="$(/usr/bin/mktemp /private/tmp/weixin-channels-watchdog.XXXXXX)"
trap '/bin/rm -f "${watchdog_rendered}"' EXIT

watchdog_fail() { print -u2 -- "$1"; exit 1; }

watchdog_render() {
  watchdog_escaped="${watchdog_repo_dir//&/\\&}"
  watchdog_escaped="${watchdog_escaped//|/\\|}"
  /usr/bin/sed "s|__WEIXIN_CHANNELS_REPO_ROOT__|${watchdog_escaped}|g" \
    "${watchdog_source_plist}" > "${watchdog_rendered}"
}

watchdog_validate() {
  /bin/zsh -f -o NO_BG_NICE -n "${watchdog_source}" || watchdog_fail "watchdog_script_invalid"
  /bin/zsh -f -o NO_BG_NICE -n "${watchdog_installer}" || watchdog_fail "watchdog_installer_invalid"
  /usr/bin/plutil -lint "${watchdog_source_plist}" >/dev/null || watchdog_fail "watchdog_plist_invalid"
  "${watchdog_source}" --check-source >/dev/null || watchdog_fail "watchdog_source_check_failed"
  watchdog_render
  /usr/bin/plutil -lint "${watchdog_rendered}" >/dev/null || watchdog_fail "watchdog_rendered_plist_invalid"
}

watchdog_mode="${1:---check-source}"
watchdog_validate
case "${watchdog_mode}" in
  --check-source)
    print -- "weixin_channels_watchdog_source_ok"
    ;;
  --install)
    /bin/mkdir -p "${watchdog_target_dir}"
    /usr/bin/install -m 600 "${watchdog_rendered}" "${watchdog_target_plist}"
    if /bin/launchctl print "${watchdog_domain}/${watchdog_label}" >/dev/null 2>&1; then
      /bin/launchctl bootout "${watchdog_domain}" "${watchdog_target_plist}"
    fi
    /bin/launchctl bootstrap "${watchdog_domain}" "${watchdog_target_plist}"
    /bin/launchctl print "${watchdog_domain}/${watchdog_label}" >/dev/null \
      || watchdog_fail "watchdog_service_not_loaded"
    print -- "weixin_channels_watchdog_installed"
    ;;
  --check)
    [[ -f "${watchdog_target_plist}" ]] || watchdog_fail "watchdog_installed_plist_missing"
    /usr/bin/cmp -s "${watchdog_rendered}" "${watchdog_target_plist}" \
      || watchdog_fail "watchdog_installed_plist_out_of_date"
    /bin/launchctl print "${watchdog_domain}/${watchdog_label}" >/dev/null \
      || watchdog_fail "watchdog_service_not_loaded"
    print -- "weixin_channels_watchdog_ok"
    ;;
  *)
    watchdog_fail "usage: ${watchdog_installer} --check-source|--install|--check"
    ;;
esac
