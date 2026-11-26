#!/usr/bin/env bash
# deploy-platform.sh — build and deploy the lux-platform Lambda (Lux HQ backend) on macOS/Linux.
# Usage: scripts/deploy-platform.sh test|staging|prod   (prod needs HQ_CONFIRM_PROD=yes)
# Code only: env vars, routes and the function itself come from scripts/hq-provision-env.sh.
set -euo pipefail
ENV="${1:-}"
case "$ENV" in test|staging) FN="lux-platform-$ENV" ;; prod) FN="lux-platform" ;; *) echo "Usage: $0 test|staging|prod"; exit 1 ;; esac
if [ "$ENV" = prod ] && [ "${HQ_CONFIRM_PROD:-}" != yes ]; then echo "Refusing to touch prod without HQ_CONFIRM_PROD=yes"; exit 1; fi
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/services/api/dist/platform"
rm -rf "$OUT" && mkdir -p "$OUT/_stage"
"$ROOT/node_modules/.bin/esbuild" "$ROOT/services/api/src/platform/handler.ts" --bundle --platform=node --target=node20 \
  '--external:@aws-sdk/*' --outfile="$OUT/_stage/index.js" --minify --log-level=warning
(cd "$OUT/_stage" && zip -qr ../lux-platform.zip index.js)
echo "Built $(wc -c < "$OUT/lux-platform.zip" | tr -d ' ') bytes"

if [ "${BUILD_ONLY:-}" = 1 ]; then exit 0; fi
aws lambda update-function-code --function-name "$FN" --zip-file "fileb://$OUT/lux-platform.zip" --query LastUpdateStatus --output text >/dev/null
aws lambda wait function-updated-v2 --function-name "$FN"
echo "Deployed $FN"
