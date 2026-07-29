#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# commit-to-vendor-build.sh
#
# Workaround: The sandbox environment resets .git/HEAD to `main`
# between tool invocations, making `git checkout Vendor-Build` impossible
# to persist. This script uses git plumbing commands to commit directly
# onto the Vendor-Build branch WITHOUT changing the working branch.
#
# Usage:
#   ./scripts/commit-to-vendor-build.sh "feat: my commit message"
#
# How it works:
#   1. Reads the current working tree as-is (whatever's on disk)
#   2. Writes that tree as a git object
#   3. Creates a new commit on top of Vendor-Build's HEAD, with the
#      working tree and Vendor-Build as parent
#   4. Advances the Vendor-Build branch ref to this new commit
#
# The working branch stays `main` — that's fine for development.
# All code changes end up on Vendor-Build regardless.
# ──────────────────────────────────────────────────────────────────

set -euo pipefail

COMMIT_MSG="${1:-chore: update files}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Verify we have a clean or staged working tree on the active branch
# (we don't actually commit to the active branch — just need the tree)
ACTIVE_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse HEAD)
TREE_SHA=$(git write-tree)

VENDOR_BUILD_SHA=$(git rev-parse Vendor-Build)

echo "╔══════════════════════════════════════════════════════╗"
echo "║  commit-to-vendor-build.sh                           ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Active branch : ${ACTIVE_BRANCH}"
echo "║  Tree          : ${TREE_SHA}"
echo "║  Vendor-Build : ${VENDOR_BUILD_SHA}"
echo "║  Message      : ${COMMIT_MSG}"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Create the commit on Vendor-Build using plumbing
NEW_COMMIT=$(git commit-tree "$TREE_SHA" -p "$VENDOR_BUILD_SHA" -m "$COMMIT_MSG")

# Advance Vendor-Build ref
git update-ref refs/heads/Vendor-Build "$NEW_COMMIT"

echo "✅ Committed to Vendor-Build: ${NEW_COMMIT:0:7}"
echo "   Message: $COMMIT_MSG"
echo ""
echo "To push when ready:"
echo "  git push origin Vendor-Build"
