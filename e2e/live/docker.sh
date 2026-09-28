#!/usr/bin/env bash
# Layer 3 (#203/local): boots or tears down the throwaway odin-core
# identity-host container used by both the "E2E live" CI workflow
# (.github/workflows/e2e-live-docker.yml) and `npm run e2e:live:docker`
# locally, so the two can't drift. Never touches /etc/hosts, a keychain, or a
# trust store — CI does that itself around this script; locally the caller
# points Chromium at 127.0.0.1 via --host-resolver-rules instead (see
# playwright.live.config.ts) and probes here with `curl --resolve`.
set -euo pipefail

cmd="${1:-}"
[ "$cmd" = up ] || [ "$cmd" = down ] || { echo "usage: $0 up|down" >&2; exit 1; }

# Same env var name the CI workflow already sets at job level.
IMAGE="${IMAGE:-ghcr.io/homebase-id/odin-core@sha256:ee63bcd309cf4c90450354697764db38640a6b6d76d07da797fb0425c7a84061}"
IDENTITY="${E2E_LIVE_IDENTITY:-frodo.dotyou.cloud}"
CONTAINER_NAME=journal-e2e-live-docker
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERTS_DIR="$ROOT_DIR/e2e/.certs/live-docker"

# Nothing here talks to a real registry/host beyond 127.0.0.1 and the
# container itself.
port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  # lsof missing: best-effort fallback. curl exits 7 ("couldn't connect")
  # only when nothing is listening; anything else (including a garbled
  # non-HTTP reply from a TLS port) means something answered the connect. A
  # filtered port would look identical to "busy" here, so prefer lsof.
  curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1" 2>/dev/null
  [ "$?" -ne 7 ]
}

up() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "error: container '$CONTAINER_NAME' already exists — run '$0 down' first" >&2
    exit 1
  fi
  for port in 80 443; do
    if port_busy "$port"; then
      echo "error: something is already listening on 127.0.0.1:$port — refusing to start (could be a real odin-core with real data)" >&2
      exit 1
    fi
  done

  rm -rf "$CERTS_DIR"
  mkdir -p "$CERTS_DIR"
  (
    cd "$CERTS_DIR"
    openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 \
      -subj "/CN=Journal e2e-live throwaway CA (local)" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
    # odin-core's preconfigured dev identities. CertificateStore requires an
    # ECDSA leaf (GetECDsaPrivateKey() crashes the host on an RSA one), and
    # DevEnvironmentSetup exits if ANY of these is missing a cert, even ones
    # this run never talks to.
    DOMAINS="frodo sam merry pippin tom collab"
    SAN="DNS:dotyou.cloud,DNS:*.dotyou.cloud"
    for d in $DOMAINS; do SAN="$SAN,DNS:*.$d.dotyou.cloud"; done
    openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout leaf.key -out leaf.csr -subj "/CN=*.dotyou.cloud"
    printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n' "$SAN" > leaf.ext
    openssl x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out leaf.crt -days 30 -extfile leaf.ext
    # <SslSourcePath>/<domain>/{certificate.crt,private.key}, per the host's
    # own layout.
    for d in $DOMAINS admin provisioning; do
      mkdir -p "https/$d.dotyou.cloud"
      cp leaf.crt "https/$d.dotyou.cloud/certificate.crt"
      cp leaf.key "https/$d.dotyou.cloud/private.key"
    done
    # e2e/support/make-cert.mjs serves the app with this same leaf.
    mkdir -p app && cp leaf.crt app/e2e.crt && cp leaf.key app/e2e.key
  )

  docker run --rm --entrypoint cat "$IMAGE" /app/web/appsettings.development.json > "$CERTS_DIR/appsettings.e2e.json"
  docker run -d --name "$CONTAINER_NAME" \
    -e ASPNETCORE_ENVIRONMENT=e2e \
    -e Development__SslSourcePath=/certs/https/ \
    -v "$CERTS_DIR/appsettings.e2e.json:/app/web/appsettings.e2e.json:ro" \
    -v "$CERTS_DIR/https:/certs/https:ro" \
    -p 127.0.0.1:80:80 -p 127.0.0.1:443:443 \
    "$IMAGE" >/dev/null

  ok=false
  for _ in $(seq 1 90); do
    out=$(curl -sS -k --resolve "${IDENTITY}:443:127.0.0.1" "https://${IDENTITY}/api/owner/v1/authentication/verifyToken" 2>&1) && { ok=true; break; }
    sleep 2
  done
  echo "verifyToken -> ${out:-<no response>}"
  if [ "$ok" != true ] || [ "$out" != "false" ]; then
    echo "error: verifyToken probe did not return false within 3 minutes" >&2
    docker logs "$CONTAINER_NAME" 2>&1 | tail -n 300 || true
    exit 1
  fi
  echo "identity-host ready: https://${IDENTITY} (container: $CONTAINER_NAME, certs: $CERTS_DIR)"
}

down() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$CERTS_DIR"
}

"$cmd"
