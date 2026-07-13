# Deploying Stellar Shield to a VPS

**This is a light deploy.** Non-custodial (no DB, no server-side key custody),
the ZK proving runs client-side in the browser, and the Soroban contract lives
on Stellar testnet (not self-hosted). The server's whole job is to serve a
mostly-static dashboard plus ~77 MB of ZK artifacts. Build in CI, front the
artifacts with a CDN, and the smallest box is enough.

## Recommended shape

| Box | Spec | Runs | Cost |
|-----|------|------|------|
| **web** | 1 vCPU / 1 GB / 25 GB SSD | Caddy + `next start` (systemd) | ~$5–6/mo |
| **keeper** | 1 vCPU / 512 MB–1 GB | liquidation keeper timer (holds hot keys) | ~$5/mo |

Two boxes because the autonomous keeper holds **hot keys** — keep them off the
public web tier. On testnet (play-money) you *may* co-locate them and accept the
blast radius; do not carry that pattern to mainnet. Cloudflare free + Let's
Encrypt = $0. **Total ~$10–12/mo.** The only cost that scales with users is
egress on the artifacts, and the CDN eats it.

## Files here

| File | Purpose |
|------|---------|
| `Caddyfile` | TLS + reverse proxy; serves `/circuits-circom/*` static with long cache + cross-origin-isolation headers |
| `stellar-shield.service` | systemd unit for the web app (`next start`) |
| `stellar-shield-keeper.service` + `.timer` | one-shot keeper run, every 3 min |
| `keeper.env.example` | keeper runtime env incl. hot-key slots (→ `/etc/stellar-shield/keeper.env`, chmod 600) |
| `build.env.example` | the `NEXT_PUBLIC_*` **build-time** vars (→ GitHub Actions vars/secrets) |
| `../.github/workflows/deploy.yml` | build-in-CI → rsync → restart |

## Rollout (bare VPS → live)

1. **Provision** one Ubuntu LTS VPS. Note its IP.
2. **Harden**: non-root sudo user (`deploy`); add your SSH pubkey; disable root
   login + password auth; `ufw allow 22,80,443`; enable `unattended-upgrades`.
3. **Install Bun** as `deploy`: `curl -fsSL https://bun.sh/install | bash`
   (lands in `~/.bun/bin` — the systemd units reference `%h/.bun/bin/bun`).
4. **Install Caddy** (official apt repo). It auto-provisions and auto-renews TLS.
5. **Lay out the app dir**: `sudo mkdir -p /srv/stellar-shield/current &&
   sudo chown -R deploy:deploy /srv/stellar-shield`. Put the repo here (or let
   the first CI deploy populate it — you still need `package.json`/`bun.lock`
   present for the box `bun install`, so `git clone` once to seed it).
6. **Caddy config**: copy `Caddyfile` to `/etc/caddy/Caddyfile`, set your
   domain, `sudo systemctl reload caddy`.
7. **App service**: `sudo cp deploy/stellar-shield.service /etc/systemd/system/`
   → `sudo systemctl daemon-reload && sudo systemctl enable --now stellar-shield`.
8. **Sudoers for deploy** (so CI can restart without a password), `visudo`:
   `deploy ALL=(root) NOPASSWD: /bin/systemctl restart stellar-shield`
9. **DNS**: point the domain at the box. If using Cloudflare, add the record
   there with the orange proxy **on** (this is what caches the zkeys).
10. **CI secrets/vars** (GitHub → repo settings):
    - *Variables*: the `NEXT_PUBLIC_STELLAR_*` values from `build.env.example`.
    - *Secrets*: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `DEPLOY_SSH_KEY`
      (private key whose pub half is in `deploy`'s `authorized_keys`),
      `DEPLOY_HOST`, `DEPLOY_USER` (=`deploy`).
11. **Deploy**: run the **Deploy** workflow (Actions → Deploy → Run). It builds,
    rsyncs, `bun install`, restarts.
12. **Smoke test**: load the site, connect wallet, run one borrow end-to-end —
    this pulls `borrow.zkey` (~31 MB) and proves in-browser. Confirm it works.

### Keeper box (autonomous liquidation)

On a **separate** box: repeat steps 1–3, seed the repo at
`/srv/stellar-shield/current`, `bun install`, then:

```
sudo useradd -r -m keeper                        # or reuse deploy
sudo mkdir -p /etc/stellar-shield
sudo install -m600 deploy/keeper.env.example /etc/stellar-shield/keeper.env
sudo $EDITOR /etc/stellar-shield/keeper.env      # fill contract id, RPC, hot keys
sudo cp deploy/stellar-shield-keeper.service deploy/stellar-shield-keeper.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stellar-shield-keeper.timer
```

Drop `--trigger` from the service for read-only watchlist mode (then
`LIQUIDATOR_SECRET` is unused). `journalctl -u stellar-shield-keeper` for logs.

## Ops checklist

- **TLS auto-renew** — Caddy, nothing to do.
- **Auto-restart** — systemd `Restart=always` (web) / timer (keeper).
- **Health check** — point an external pinger (UptimeRobot free) at `/`.
- **Log rotation** — journald caps by default; `journalctl --vacuum-size=500M` or set `SystemMaxUse=500M`.
- **Redeploy** — re-run the Deploy workflow. Manual fallback on the box:
  `cd /srv/stellar-shield/current && bun install && bun run build && sudo systemctl restart stellar-shield`
  (only if you build on-box — needs ≥2 GB RAM + Google-Fonts network; see gotchas).
- **Backups** — none needed. No DB. Code is in git; the only stateful secret is
  `/etc/stellar-shield/keeper.env` — copy it to a password manager, box is
  reproducible from `git clone`.

## Gotchas

- **Google Fonts at build.** `next/font` fetches fonts during `next build`. CI
  has network, so this is handled — do **not** build on an air-gapped box. Lazy
  permanent fix if you want to cut the dependency: switch `next/font/google` to
  `next/font/local` and vendor the `.woff2` files. Not required for the CI path.
- **Cross-origin isolation.** The app sets `COOP: same-origin` +
  `COEP: require-corp` (for SharedArrayBuffer in the WASM prover). The Caddyfile
  keeps the zkeys same-origin and sets `Cross-Origin-Resource-Policy`. If you
  move artifacts to a separate CDN *subdomain*, they become cross-origin and you
  must serve CORP `cross-origin` + CORS or the browser blocks them.
- **zkey egress.** ~33 MB per first-time borrower. Fine on testnet; the
  Cloudflare cache rule on `/circuits-circom/*` is what keeps origin egress flat
  as users grow.
- **Keeper secret co-location.** A hot key on a web-facing box widens the blast
  radius. Separate box, minimal funding, or knowingly accept it on testnet.

## Deliberately deferred

Containers/k8s, autoscaling, load balancer, monitoring stack (Prometheus/
Grafana), centralized logging, on-call, staging env, IaC, DB HA (no DB). Add
none of it until one box measurably can't keep up — with browser-side proving
and a CDN, that day is far off. This is a testnet technical validation; no
uptime SLA is warranted. If the box dies, redeploy in under an hour.
