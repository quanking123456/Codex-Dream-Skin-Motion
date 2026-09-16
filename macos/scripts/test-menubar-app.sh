#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PACKAGE_ROOT="$ROOT/menubar-app"

# SwiftPM's test driver can return 1 on current GitHub macOS images even after
# every XCTest passes. Build the test bundle with SwiftPM, then execute that
# bundle with Apple's XCTest runner so the exit status reflects the test run.
/usr/bin/swift build --package-path "$PACKAGE_ROOT" --build-tests
BIN_DIR="$(/usr/bin/swift build --package-path "$PACKAGE_ROOT" --show-bin-path)"
TEST_BUNDLE="$BIN_DIR/CodexDreamSkinMenuBarPackageTests.xctest"
[ -d "$TEST_BUNDLE" ] \
  || { printf 'Native XCTest bundle is missing: %s\n' "$TEST_BUNDLE" >&2; exit 1; }
LOG="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/codex-dream-skin-xctest.XXXXXX")"
trap '/bin/rm -f "$LOG"' EXIT
set +e
/usr/bin/xcrun xctest "$TEST_BUNDLE" 2>&1 | /usr/bin/tee "$LOG"
XCTEST_STATUS="${PIPESTATUS[0]}"
set -e

# GitHub's current ARM macOS images return 1 after XCTest has emitted a
# complete successful report. Never accept that status blindly: require both
# the final all-tests success marker and a nonzero test count with no failures.
if [ "$XCTEST_STATUS" -ne 0 ]; then
  /usr/bin/grep -E -q "^Test Suite 'All tests' passed at " "$LOG" \
    && /usr/bin/grep -E -q 'Executed [1-9][0-9]* tests, with 0 failures \(0 unexpected\)' "$LOG" \
    && ! /usr/bin/grep -E -q "Test (Case|Suite) '.*' failed|(^|[[:space:]])(error|fatal error):" "$LOG" \
    || exit "$XCTEST_STATUS"
  printf 'WARNING: XCTest reported a complete pass but returned status %s; accepting the verified report.\n' \
    "$XCTEST_STATUS" >&2
fi
