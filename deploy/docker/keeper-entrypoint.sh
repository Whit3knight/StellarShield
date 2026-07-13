#!/usr/bin/env bash
# Re-runs the ONE-SHOT liquidation scan on an interval. scan-underwater.ts does a
# single pass and exits, so it must be re-invoked (systemd does this via
# OnUnitActiveSec=3min; here a plain loop does it).
#
#   timeout 120  — a hung RPC call can't wedge the loop.
#   || true      — a failed pass never kills the loop.
#   KEEPER_INTERVAL (default 180s) matches the systemd 3-minute cadence.
#   KEEPER_ARGS    (default --trigger) — set to "" in keeper.env for read-only
#                  watchlist mode (then LIQUIDATOR_SECRET is unused).
set -u

INTERVAL="${KEEPER_INTERVAL:-180}"
# Colonless `-` so an explicit KEEPER_ARGS="" stays empty (watchlist mode);
# only an *unset* KEEPER_ARGS falls back to --trigger.
ARGS="${KEEPER_ARGS-"--trigger"}"

echo "keeper: interval=${INTERVAL}s args=[${ARGS}]"
while true; do
  # ARGS unquoted on purpose so an empty value expands to no args (watchlist mode).
  # -k 10: SIGKILL 10s after SIGTERM if a wedged Bun process ignores the term.
  timeout -k 10 120 bun contracts/scripts/scan-underwater.ts ${ARGS} || true
  sleep "${INTERVAL}"
done
