# Keeper via Docker Compose

A containerized liquidation keeper for hosts that run Docker instead of systemd.

This **replaces** the systemd keeper (`deploy/stellar-shield-keeper.service` +
`.timer`) — run **one or the other, never both**, or you double-submit
liquidations. The web tier is on **Vercel** and is not containerized; nothing
here serves the dashboard.

## Run

```bash
cd deploy/docker
cp ../keeper.env.example keeper.env
chmod 600 keeper.env          # hot keys — owner-only
$EDITOR keeper.env            # contract id, RPC, and the hot keys below
docker compose up -d
docker compose logs -f keeper
```

`docker compose up -d` builds `Dockerfile.keeper` (Bun runs the TypeScript
directly — no build step) and starts one `keeper` service that re-runs the
one-shot scan every `KEEPER_INTERVAL` seconds (default 180, matching the systemd
3-minute cadence). `restart: unless-stopped` brings it back after a host reboot.

Stop / update:

```bash
docker compose down
docker compose up -d --build   # after a git pull
```

## Trigger vs watchlist mode

- **Trigger (default):** `KEEPER_ARGS=--trigger` (the built-in default). Signs and
  submits liquidations. Requires `LIQUIDATION_SERVICE_SK` **and**
  `LIQUIDATOR_SECRET`.
- **Watchlist (read-only):** add `KEEPER_ARGS=` (empty) to `keeper.env`. Surfaces
  triage candidates only; `LIQUIDATOR_SECRET` is then unused.

Tune cadence with `KEEPER_INTERVAL=<seconds>` in `keeper.env`.

## Hot-key warning

With `--trigger` this container holds **real signing secrets**
(`LIQUIDATION_SERVICE_SK`, `LIQUIDATOR_SECRET`). Treat `keeper.env` as
credentials: `chmod 600`, never commit it (it is git- and docker-ignored), and
run this on a box **separate from anything public-facing** so a web compromise
never sees the liquidation key. Fund `LIQUIDATOR_SECRET` minimally.

## What the image contains

Lean by design (`.dockerignore` at the repo root): no `node_modules` (installed
in-image), no `.next`, no `.git`, no `contracts/circuits` build cruft, and none
of the large per-circuit zkeys. It keeps **only**
`public/circuits-circom/shielded/liquidate-v2/{liquidate.wasm,liquidate.zkey}`
(~2.8 MB), which the keeper reads to build liquidation proofs in `--trigger`
mode. The container runs as the non-root `bun` user with a read-only root
filesystem (writable `tmpfs` at `/tmp` only), no published ports, and 256 MB /
0.5 CPU caps.
