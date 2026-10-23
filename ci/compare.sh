#!/usr/bin/env bash
# Builds a site twice and compares the two builds, for the weekly dependency
# update. <before> and <after> are checkouts with node_modules installed.
#
#   ci/compare.sh <before> <after> <report-dir>
#
# Exit code 0: no difference; 1: differences (report.md says which);
# 3: <after> does not build (the log is <report-dir>/build.log); anything
# else: the comparison itself failed.
set -euo pipefail
ci=$(cd "$(dirname "$0")" && pwd)
before=$1 after=$2 report=$3
mkdir -p "$report"

(cd "$before" && npm run build)
if ! (cd "$after" && npm run build) > "$report/build.log" 2>&1; then
  tail -50 "$report/build.log"
  exit 3
fi

(cd "$ci" && npm ci --no-audit --no-fund && npx playwright install --with-deps chromium)
node "$ci/visual-diff.mjs" "$before/dist" "$after/dist" "$report"
