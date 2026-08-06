#!/usr/bin/env sh
set -eu

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

BACKEND_URL_ESCAPED="$(escape_js_string "${VITE_BACKEND_URL:-http://localhost:3000}")"
NOVNC_URL_ESCAPED="$(escape_js_string "${VITE_NOVNC_URL:-http://localhost:6080}")"
ENABLE_NOVNC_ESCAPED="$(escape_js_string "${VITE_ENABLE_NOVNC:-true}")"

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__WRIGHTTEST_CONFIG__ = {
  VITE_BACKEND_URL: "${BACKEND_URL_ESCAPED}",
  VITE_NOVNC_URL: "${NOVNC_URL_ESCAPED}",
  VITE_ENABLE_NOVNC: "${ENABLE_NOVNC_ESCAPED}"
};
EOF
