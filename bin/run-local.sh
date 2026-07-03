#!/usr/bin/env bash
# Run the monorepo manager container against a monorepo on this machine, without compose.
#
#   bin/run-local.sh /absolute/path/to/your/monorepo [host-port]
#
# Builds the image if it isn't present yet, then serves the web UI on http://localhost:<host-port>
# (default 44444). Ctrl-C stops it (the container is --rm).
#
# The monorepo must have a Modules-Manifest.json at (or above) its root; the server walks up from
# the mount to find it. Generate one with `mm manifest migrate` / `mm manifest backfill --write`.
#
# Overrides (env vars):
#   MM_IMAGE=monorepo-manager:local   # image tag to run (built if missing)
#   MOUNT_GIT=1                       # also mount ~/.gitconfig + ~/.ssh (read-only) for commit/push

set -euo pipefail

cd "$(dirname "$0")/.."

MONOREPO="${1:?usage: bin/run-local.sh /absolute/path/to/monorepo [host-port]}"
PORT="${2:-44444}"
IMAGE="${MM_IMAGE:-monorepo-manager:local}"

# Resolve the monorepo to an absolute path (bind mounts require it).
if [ ! -d "${MONOREPO}" ]; then
	echo "ERROR: not a directory: ${MONOREPO}" >&2
	exit 1
fi
MONOREPO="$(cd "${MONOREPO}" && pwd)"

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
	echo "→ image ${IMAGE} not found; building it once…"
	docker build -t "${IMAGE}" .
fi

GIT_MOUNTS=()
if [ "${MOUNT_GIT:-0}" = "1" ]; then
	[ -f "${HOME}/.gitconfig" ] && GIT_MOUNTS+=(-v "${HOME}/.gitconfig:/root/.gitconfig:ro")
	[ -d "${HOME}/.ssh" ]       && GIT_MOUNTS+=(-v "${HOME}/.ssh:/root/.ssh:ro")
fi

echo "→ monorepo  ${MONOREPO}"
echo "→ image     ${IMAGE}"
echo "→ url       http://localhost:${PORT}"
echo

exec docker run --rm -it \
	-p "${PORT}:44444" \
	-v "${MONOREPO}:/monorepo" \
	"${GIT_MOUNTS[@]}" \
	"${IMAGE}"
