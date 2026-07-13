# Deploying Stellar Shield

**Two tiers, deployed separately:**

- **Web tier → Vercel** (recommended). The dashboard is a Next.js app: mostly
  static, non-custodial (no DB, no server-side keys), and the ZK proving runs
  client-side in the browser. Vercel is already wired in
  `.github/workflows/ci-cd.yml` — zero servers to run.
- **Keeper tier → one small box.** The liquidation keeper is a long-running,
  hot-key-holding worker. Serverless can't host it, so it lives on a tiny VPS
  (or your own machine). This is what `provision.sh --role keeper` sets up.

A self-host alternative for the web tier (Caddy + `next start` on a VPS) is kept
at the bottom for completeness, but Vercel is the intended path.

---

## Web tier — Vercel

Already configured; nothing to build by hand.

**How it deploys** (`.github/workflows/ci-cd.yml`):
- push to `staging` → `vercel deploy` **preview**
- push to `main` → `vercel deploy --prod` **production**

**One-time setup:**
1. Import the repo into a Vercel project. Framework auto-detects as Next.js;
   install/build auto-detect Bun from `bun.lock` (build = `bun run build`).
2. **Vercel → Settings → Environment Variables** — set the `NEXT_PUBLIC_*`
   values from `build.env.example` (they are inlined into the client bundle at
   build; none are secret — they're public chain identifiers). Add
   `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
3. **GitHub repo secrets** for the CI deploy: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID` (from `vercel link` / the Vercel dashboard).
4. Point your domain at Vercel (or use the `*.vercel.app` URL).
5. Smoke test: load the site, connect wallet, run one borrow end-to-end — this
   pulls `borrow.zkey` (~32 MB) and proves in-browser. Confirm it works.

**Plan / bandwidth.** The 77 MB of ZK artifacts in `public/circuits-circom/`
are served straight from Vercel's CDN (never bundled into a function). First
borrow ships ~33 MB/user. Hobby includes 100 GB/mo egress, Pro 1 TB. At testnet
volume this is noise; the day it isn't, that's your signal to move to Pro (also
the correct plan once it's a real/commercial product). No Cloudflare needed —
Vercel is the edge.

**One constraint to respect:** the app sets `Cross-Origin-Embedder-Policy:
require-corp` (for SharedArrayBuffer in the WASM prover, `next.config.ts`). Keep
every subresource same-origin — do **not** add a cross-origin analytics iframe,
external image host, or third-party CDN, or the browser will block it.

---

## Keeper tier — one small box

A separate cheap box (~$5/mo) that holds the **hot keys** and runs the
liquidation keeper on a timer. Keep it off the web tier — a hot signing key does
not belong on anything public-facing.

**Automated (recommended):**

```bash
# On a fresh Ubuntu LTS box, as root:
git clone git@github.com:Whit3knight/StellarShield.git /srv/stellar-shield/current
cd /srv/stellar-shield/current
sudo bash deploy/provision.sh --role keeper           # --dry-run to preview first
```

`provision.sh --role keeper` is idempotent and:
- creates the `keeper` user, installs Bun as that user, seeds the repo, `bun install`;
- installs `stellar-shield-keeper.service` + `.timer`;
- seeds `/etc/stellar-shield/keeper.env` from the template (root-owned, chmod
  600) **only if absent** — it never clobbers real hot keys;
- **enables** the timer but does **not** start it (you fill the env first);
- sets `ufw` (allows 22 before enabling so SSH survives);
- does NOT touch sshd, does NOT write secrets, does NOT run `next build`.

**Then, by hand:**
```bash
sudo $EDITOR /etc/stellar-shield/keeper.env    # contract id, RPC, LIQUIDATION_SERVICE_SK, LIQUIDATOR_SECRET
sudo systemctl start stellar-shield-keeper.timer
journalctl -u stellar-shield-keeper -f         # watch it
```
Drop `--trigger` from `stellar-shield-keeper.service` for read-only watchlist
mode (then `LIQUIDATOR_SECRET` is unused). Fund `LIQUIDATOR_SECRET` minimally.

Files: `stellar-shield-keeper.service`, `stellar-shield-keeper.timer`,
`keeper.env.example`.

---

## Cost

| Item | Cost |
|------|------|
| Vercel — Hobby (testnet, near-zero traffic) | $0 |
| Vercel — Pro (real/commercial, 1 TB egress) | ~$20/mo |
| Keeper box (1 vCPU / 512 MB–1 GB) | ~$5/mo |
| Domain | ~$1/mo |

**Starting: ~$5–6/mo** (Hobby + keeper box). The only cost that scales with
users is Vercel egress on the artifacts; Pro covers it long before testnet does.

## Ops

- **Web:** nothing — Vercel handles TLS, CDN, restarts, rollbacks, preview URLs.
- **Keeper:** `Restart` via timer; `journalctl -u stellar-shield-keeper` for
  logs; the only secret is `/etc/stellar-shield/keeper.env` — copy it to a
  password manager (the box is otherwise reproducible from `git clone` +
  `provision.sh`). No DB anywhere = no backups.
- **Redeploy web:** merge to `main`. **Redeploy keeper:** re-run
  `provision.sh --role keeper` (idempotent) or `git pull && bun install` on the box.

## Deferred

Containers/k8s, autoscaling, monitoring stack, on-call, DB HA (no DB). This is a
testnet technical validation; no uptime SLA is warranted.

---

## Alternative: self-host the web tier on a VPS

If you'd rather not use Vercel, the web tier can run on a VPS behind Caddy. This
path is **not** the default and duplicates what Vercel does for free at this
scale — use it only if you specifically want to self-host.

- `Caddyfile` — TLS + reverse proxy to `next start`; serves `/circuits-circom/*`
  static with immutable cache + cross-origin-isolation headers (front it with
  Cloudflare to cache the zkeys and flatten egress).
- `stellar-shield.service` — systemd unit for `next start`.
- `.github/workflows/deploy.yml` — build in CI (keeps the RAM spike + the
  `next/font` Google-Fonts network dependency off the box), rsync the built
  app, `bun install`, `systemctl restart`.
- `provision.sh --role web --domain <d>` (or `--role all` to co-locate keeper +
  web on one box — testnet only, since it puts hot keys on the public tier).

Set the `NEXT_PUBLIC_*` build vars as GitHub Actions repo variables (see
`build.env.example`) and the SSH deploy secrets (`DEPLOY_SSH_KEY`,
`DEPLOY_HOST`, `DEPLOY_USER`). Gotcha reminders: `next/font` needs network at
build (handled in CI), and if you serve artifacts from a separate CDN subdomain
they become cross-origin and need CORP `cross-origin` + CORS under the COEP
header.
