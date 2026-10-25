#!/usr/bin/env bash
# Installs and builds a site twice and compares the two builds, for the
# weekly dependency update. <before> and <after> are checkouts of the site.
#
#   ci/compare.sh <before> <after> <report-dir>
#
# Each side is installed from its own lockfile with `npm ci`, the way the
# hosts install it. `npm install` only warns about a peer conflict that makes
# `npm ci` fail (TypeScript 7 next to @astrojs/check did exactly that), so a
# lockfile that does not pass `npm ci` here would not deploy either.
#
# Exit code 0: no difference; 1: differences (report.md says which);
# 3: <after> does not build (<report-dir>/build.log); 4: <after> does not
# install (<report-dir>/install.log); anything else: the comparison itself
# failed.
set -euo pipefail
ci=$(cd "$(dirname "$0")" && pwd)
before=$1 after=$2 report=$3
mkdir -p "$report"

(cd "$before" && npm ci --no-audit --no-fund && npm run build)
if ! (cd "$after" && npm ci --no-audit --no-fund) > "$report/install.log" 2>&1; then
  tail -50 "$report/install.log"
  exit 4
fi
if ! (cd "$after" && npm run build) > "$report/build.log" 2>&1; then
  tail -50 "$report/build.log"
  exit 3
fi

# The browser only: GitHub's Ubuntu image already has Chrome's system
# libraries, and `--with-deps` once spent 8 minutes on a slow apt mirror.
(cd "$ci" && npm ci --no-audit --no-fund && npx playwright install chromium-headless-shell)
node "$ci/visual-diff.mjs" "$before/dist" "$after/dist" "$report"
