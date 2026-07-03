#!/usr/bin/env bash
# Build + push the monorepo-manager container image from this machine, bypassing
# GitHub Actions. For dev iteration when the multi-arch GH build (~25 min) is
# too slow.
#
# Defaults:
#   - Tag:      dev-<git short SHA>          (won't clobber a published version)
#   - Platform: linux/amd64                  (fast; one arch, native or single-emul)
#   - Registry: ghcr.io/fable-retold/...     (matches the GH workflow)
#
# Overrides (env vars):
#   PUBLISH_TAG=foo                          # use this tag instead
#   PUBLISH_PLATFORMS=linux/amd64,linux/arm64  # multi-arch (slow)
#   PUBLISH_REGISTRY=ghcr.io/myorg           # different registry
#   DRY_RUN=1                                # show what would happen, don't push
#
# Pre-reqs:
#   - `docker login ghcr.io` already done with a token that has write:packages
#   - `docker buildx` available (Docker Desktop ships it)

set -euo pipefail

cd "$(dirname "$0")/.."
NAME=$(node -p "require('./package.json').name")
REGISTRY="${PUBLISH_REGISTRY:-ghcr.io/fable-retold}"
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
TAG="${PUBLISH_TAG:-dev-${SHA}}"
PLATFORMS="${PUBLISH_PLATFORMS:-linux/amd64}"
IMAGE="${REGISTRY}/${NAME}:${TAG}"

echo "→ name      ${NAME}"
echo "→ tag       ${TAG}"
echo "→ image     ${IMAGE}"
echo "→ platforms ${PLATFORMS}"

if [ "${DRY_RUN:-0}" = "1" ]; then
	echo
	echo "DRY_RUN=1 → would run:"
	echo "  docker buildx build --platform ${PLATFORMS} -t ${IMAGE} --push ."
	exit 0
fi

# Quick auth probe — `docker login` writes ~/.docker/config.json.
if ! grep -q "ghcr.io" "${HOME}/.docker/config.json" 2>/dev/null; then
	echo
	echo "ERROR: not logged in to ghcr.io. Run:"
	echo "  echo \"<your-pat>\" | docker login ghcr.io -u <your-username> --password-stdin"
	exit 1
fi

echo
docker buildx build --platform "${PLATFORMS}" -t "${IMAGE}" --push .

echo
echo "✓ pushed ${IMAGE}"
echo "  pull with: docker pull ${IMAGE}"
