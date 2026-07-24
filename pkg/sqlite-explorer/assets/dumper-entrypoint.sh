#!/usr/bin/env sh
# Adapted from the project's original dump-informer-cache.sh, but designed to run
# FROM INSIDE THE CLUSTER as a container (no external KUBECONFIG) against a single,
# already-known target pod (the extension resolves which pod via a Steve query before
# creating this Pod, so no `kubectl get pods -l app=...` discovery is needed here).
#
# Relies on the in-cluster ServiceAccount token that kubectl auto-detects when running
# inside a pod (no KUBECONFIG needed) -- the ServiceAccount bound to THIS pod must have
# RBAC for: patch on pods/ephemeralcontainers, create on pods/exec, get on pods,
# all scoped to $TARGET_NAMESPACE. See NOTES.md "RBAC sufficiency" open question.
set -eu

: "${TARGET_POD:?TARGET_POD env var is required}"
: "${TARGET_NAMESPACE:?TARGET_NAMESPACE env var is required}"
: "${TARGET_CONTAINER:?TARGET_CONTAINER env var is required}"
: "${DUMP_IMAGE:?DUMP_IMAGE env var is required}"
: "${OUT_PATH:?OUT_PATH env var is required}"

DB_PATH="/var/lib/rancher/informer_object_cache.db"
VACUUMED_NAME="vacuumed_informer_object_cache.db"

echo "==> Creating consistent sqlite snapshot via ephemeral container on ${TARGET_NAMESPACE}/${TARGET_POD} (container: ${TARGET_CONTAINER})"
kubectl -n "$TARGET_NAMESPACE" debug "$TARGET_POD" \
  --target="$TARGET_CONTAINER" \
  --image="$DUMP_IMAGE" \
  --profile=general \
  -- /usr/local/bin/safe-sqlite-copy.sh "$DB_PATH" "/tmp/${VACUUMED_NAME}"

echo "==> Waiting for /tmp/${VACUUMED_NAME} to appear in target container"
found=0
i=0
while [ "$i" -lt 60 ]; do
  if kubectl -n "$TARGET_NAMESPACE" exec "$TARGET_POD" -c "$TARGET_CONTAINER" -- test -s "/tmp/${VACUUMED_NAME}"; then
    found=1
    break
  fi
  sleep 1
  i=$((i + 1))
done

if [ "$found" -ne 1 ]; then
  echo "ERROR: timed out waiting for ${VACUUMED_NAME} to appear" >&2
  exit 1
fi

echo "==> Copying vacuumed DB out to ${OUT_PATH}"
kubectl -n "$TARGET_NAMESPACE" cp --retries=10 -c "$TARGET_CONTAINER" \
  "${TARGET_POD}:/tmp/${VACUUMED_NAME}" "$OUT_PATH"
test -s "$OUT_PATH"

echo "==> Cleaning up /tmp/${VACUUMED_NAME} in target container"
kubectl -n "$TARGET_NAMESPACE" exec "$TARGET_POD" -c "$TARGET_CONTAINER" -- rm -f "/tmp/${VACUUMED_NAME}"

echo "==> Dump complete: ${OUT_PATH}"
echo "==> Sleeping forever so this container stays inspectable (docker logs/exec) if needed"
sleep infinity
