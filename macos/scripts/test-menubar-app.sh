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
/usr/bin/xcrun xctest "$TEST_BUNDLE"
