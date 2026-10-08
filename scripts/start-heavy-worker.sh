#!/bin/sh
# All native media tools use libc DNS, not Node's dns.setServers().
# Only the Fly rig process opts in; app/local commands keep their resolver.
set -eu
if [ "${FLY_PROCESS_GROUP:-}" != "rig" ]; then
  exec "$@"
fi

# Fly rewrites resolv.conf at boot. Start a loopback-only split resolver first,
# then direct libc to it. Do not persist addresses for changing CDN hosts.
dnsmasq --conf-file=/app/ops/heavy-worker-dns.conf --test
dnsmasq --conf-file=/app/ops/heavy-worker-dns.conf
# Preserve the Fly search/options lines; remove only upstream nameservers.
# No atomic rename: resolv.conf may be mounted by the container runtime.
awk '!/^[[:space:]]*nameserver[[:space:]]/ { print }' /etc/resolv.conf > /run/heavy-worker-resolv.conf
printf '\nnameserver 127.0.0.1\n' >> /run/heavy-worker-resolv.conf
cat /run/heavy-worker-resolv.conf > /etc/resolv.conf
exec "$@"
