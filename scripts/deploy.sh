#!/usr/bin/env bash
# Déploiement prod rock-solid — voir CURSOR.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="all"
SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    web|api|all) MODE="$arg" ;;
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help)
      echo "Usage: $0 [all|web|api] [--skip-tests]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

CACHE_ZONES=(
  /var/cache/nginx/el-astro-prod
  /var/cache/nginx/el-astro
  /var/cache/nginx/el-astro-qualif
)

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

ensure_nginx_cache_dirs() {
  for dir in "${CACHE_ZONES[@]}"; do
    sudo mkdir -p "$dir"
    sudo chown www-data:www-data "$dir"
  done
}

purge_cache_files() {
  ensure_nginx_cache_dirs
  for dir in "${CACHE_ZONES[@]}"; do
    sudo find "$dir" -type f -delete 2>/dev/null || true
  done
  log "nginx cache files purged (zone dirs kept)"
}

health_web() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:4322/ || echo 000)"
  [[ "$code" == "200" ]] || die "web health failed (HTTP $code on :4322)"
  log "web health OK (200)"
}

health_api() {
  local body
  body="$(curl -sS --max-time 10 http://127.0.0.1:8787/api/health || true)"
  echo "$body" | grep -q '"ok"' || die "api health failed: ${body:-empty}"
  log "api health OK"
}

run_tests() {
  if [[ "$SKIP_TESTS" -eq 1 ]]; then
    log "tests skipped (--skip-tests)"
    return
  fi
  log "running tests"
  npm test
}

deploy_web() {
  log "building → dist.next (atomic)"
  rm -rf dist.next
  npx astro build --outDir dist.next
  [[ -f dist.next/server/entry.mjs ]] || die "dist.next/server/entry.mjs missing after build"
  [[ -d dist.next/server/chunks ]] || die "dist.next/server/chunks missing after build"

  log "swapping dist"
  if [[ -d dist ]]; then
    rm -rf dist.prev
    mv dist dist.prev
  fi
  mv dist.next dist

  log "restart el-astro-web"
  sudo systemctl restart el-astro-web.service
  sleep 1
  sudo systemctl is-active --quiet el-astro-web.service || die "el-astro-web not active"
  health_web

  # Keep previous build briefly only on failure; success → drop
  rm -rf dist.prev
  purge_cache_files
}

deploy_api() {
  log "restart el-astro-rag-proxy"
  sudo systemctl restart el-astro-rag-proxy.service
  sleep 1
  sudo systemctl is-active --quiet el-astro-rag-proxy.service || die "el-astro-rag-proxy not active"
  health_api
}

log "mode=$MODE root=$ROOT"
run_tests

case "$MODE" in
  web)
    deploy_web
    ;;
  api)
    deploy_api
    ;;
  all)
    deploy_web
    deploy_api
    ;;
esac

log "done"
