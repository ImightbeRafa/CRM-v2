#!/usr/bin/env bash
# Probe Correos de Costa Rica Web Service ports from a Costa Rica host (Jetson).
# No secrets required. Optional token test:
#   CORREOS_WS_USERNAME=... CORREOS_WS_PASSWORD=... CORREOS_WS_SISTEMA=PYMEXPRESS ./scripts/correos-ws-probe.sh
#
# Run on Peters (or any CR machine), not from Vercel / US:
#   chmod +x scripts/correos-ws-probe.sh
#   ./scripts/correos-ws-probe.sh
set -u

TIMEOUT="${TIMEOUT:-8}"

redact() {
  sed -E \
    -e 's/("([Pp]assword|[Tt]oken|[Aa]ccess_token|[Uu]sername)"\s*:\s*")[^"]*"/\1[redacted]"/g' \
    -e 's/Bearer [A-Za-z0-9._-]+/Bearer [redacted]/g'
}

section() {
  echo
  echo "======== $1 ========"
}

probe_tcp() {
  local host="$1" port="$2"
  if nc -z -w 3 "$host" "$port" >/dev/null 2>&1; then
    echo "TCP  $host:$port  OPEN"
    return 0
  fi
  echo "TCP  $host:$port  CLOSED"
  return 1
}

probe_http() {
  local label="$1" url="$2"
  shift 2
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -sS -m "$TIMEOUT" -o "$tmp" -w '%{http_code}' "$@" "$url" 2>"${tmp}.err" || true)"
  local err
  err="$(tr '\n' ' ' <"${tmp}.err" | redact)"
  local body
  body="$(redact <"$tmp" | tr '\n' ' ' | cut -c1-220)"
  printf 'HTTP %s  %s  status=%s\n' "$label" "$url" "${code:-000}"
  if [[ -n "$err" ]]; then
    echo "     curl: $err"
  fi
  if [[ -n "$body" ]]; then
    echo "     body: $body"
  fi
  rm -f "$tmp" "${tmp}.err"
}

section "where this host exits to the internet"
echo -n "IPv4: "
curl -4 -sS -m 8 https://ifconfig.me || echo "(failed)"
echo
echo -n "IPv6: "
curl -6 -sS -m 8 https://ifconfig.me 2>/dev/null || echo "(none)"
echo

section "DNS"
for host in servicios.correos.go.cr amistadpro.correos.go.cr amistad.correos.go.cr; do
  echo -n "$host A: "
  dig +short "$host" A | tr '\n' ' '
  echo
done

section "TCP ports (same idea as nc -z)"
echo "Production (what Betsy uses today):"
probe_tcp servicios.correos.go.cr 447 || true
probe_tcp amistadpro.correos.go.cr 444 || true
echo "Documented test / sandbox:"
probe_tcp servicios.correos.go.cr 442 || true
probe_tcp amistad.correos.go.cr 84 || true
echo "Legacy / other:"
probe_tcp amistadpro.correos.go.cr 88 || true
probe_tcp amistad.correos.go.cr 82 || true

section "HTTP without credentials (proves a listener, not a login)"
probe_http "prod-token-447" "https://servicios.correos.go.cr:447/Token/authenticate" \
  -X POST -H "Content-Type: application/json" -d "{}"
probe_http "test-token-442" "https://servicios.correos.go.cr:442/Token/authenticate" \
  -X POST -H "Content-Type: application/json" -d "{}"
probe_http "prod-soap-444" "https://amistadpro.correos.go.cr:444/wsAppCorreos.wsAppCorreos.svc?wsdl"
probe_http "test-soap-84" "http://amistad.correos.go.cr:84/wsAppCorreos.wsAppCorreos.svc?wsdl"

if [[ -n "${CORREOS_WS_USERNAME:-}" && -n "${CORREOS_WS_PASSWORD:-}" ]]; then
  section "optional token POST (username set; password not printed)"
  payload="$(printf '{"Username":"%s","Password":"%s","Sistema":"%s"}' \
    "$CORREOS_WS_USERNAME" "$CORREOS_WS_PASSWORD" "${CORREOS_WS_SISTEMA:-PYMEXPRESS}")"
  probe_http "prod-token-447-auth" "https://servicios.correos.go.cr:447/Token/authenticate" \
    -X POST -H "Content-Type: application/json" -d "$payload"
  probe_http "test-token-442-auth" "https://servicios.correos.go.cr:442/Token/authenticate" \
    -X POST -H "Content-Type: application/json" -d "$payload"
else
  echo
  echo "Skip credential token test (set CORREOS_WS_USERNAME and CORREOS_WS_PASSWORD to enable)."
fi

section "how to read this"
echo "If 442/84 return HTTP (any 4xx/5xx/200) and 447/444 are connection refused:"
echo "  this machine is allowed to talk to Correos. Production listeners are down."
echo "  That is NOT a 'you must whitelist this IP' problem."
echo "If EVERY Correos port is refused, including 442/84:"
echo "  then an IP ACL or ISP filter is plausible."
echo "If 442/84 auth returns a token and 447 still refuses:"
echo "  sandbox is up; production token/SOAP is down. Do not ship real guias via sandbox"
echo "  unless Correos says those numbers are valid."
