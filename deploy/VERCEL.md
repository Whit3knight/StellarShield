# Deploying the Web Tier to Vercel via GitHub Actions

This runbook deploys the Stellar Shield dashboard to Vercel using the **existing**
`.github/workflows/ci-cd.yml` — the CI/CD path, **not** Vercel's native Git
auto-deploy. From zero.

**How the workflow deploys (already coded — do not change this mapping):**

| Trigger | Job | What it runs | Result |
|---|---|---|---|
| push to `staging` | `deploy-preview` | `vercel pull --environment=preview` → `vercel build` → `vercel deploy --prebuilt` | Preview URL |
| push to `main` | `deploy-production` | `vercel pull --environment=production` → `vercel build --prod` → `vercel deploy --prebuilt --prod` | Production |

Both jobs `needs: quality` — lint, typecheck, test, `check:artifacts`, and
`build` must pass first. Both read GitHub secrets `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

> **The #1 gotcha (read this first).** The `origin` remote
> (`git@github.com:Whit3knight/StellarShield.git`) currently has **only a
> `development` branch** — there is **no `main` and no `staging` on origin**.
> The workflow deploys *only* on pushes to `main`/`staging`. Until you create
> and push those two branches (Step 6), **nothing deploys, ever** — the Actions
> run just skips both deploy jobs. This is the single most likely thing to trip
> you up.

---

## 1. Prerequisites

- A **Vercel account** (Hobby is fine for testnet). https://vercel.com/signup
- **Push + Actions access** to the GitHub repo you deploy from. Per the deploy
  design that is `origin` = `Whit3knight/StellarShield`. You need permission to
  add repo secrets there (admin/maintainer).
- Local tooling:
  ```bash
  bun --version          # you already use Bun for this repo
  bunx vercel --version  # Vercel CLI on demand — no global install needed
  ```
  `bunx vercel ...` works without a global install. (`npm i -g vercel` also
  works if you prefer a permanent binary — optional.)

---

## 2. Create the Vercel project and get the three IDs

From the repo root:

```bash
cd /Users/bri-anadi/Devarea/stellar-shield
bunx vercel login          # opens browser, authenticates the CLI
bunx vercel link           # create/link a Vercel project to this directory
```

`vercel link` prompts for scope (your team/personal account) and a project name,
then writes `.vercel/project.json`:

```bash
cat .vercel/project.json
# { "orgId": "team_xxx...", "projectId": "prj_xxx..." }
```

- `orgId`  → the value for GitHub secret **`VERCEL_ORG_ID`**
- `projectId` → the value for GitHub secret **`VERCEL_PROJECT_ID`**

Create the token for **`VERCEL_TOKEN`** at
https://vercel.com/account/tokens → *Create Token* (name it e.g.
`stellar-shield-ci`, scope to the same team). Copy it now — it is shown once.

> **Do not commit `.vercel/`.** It is local machine state. `vercel link` adds it
> to `.gitignore` automatically, but this repo's `.gitignore` does **not** list
> it yet — confirm after linking:
> ```bash
> grep -q '^\.vercel' .gitignore || echo '.vercel' >> .gitignore
> git status --short        # .vercel/ must NOT appear as staged/tracked
> ```

---

## 3. Turn OFF Vercel's native Git auto-deploy

Because deploys come from GitHub Actions, Vercel must **not** also deploy on its
own, or every push produces two deployments.

Vercel Dashboard → your project → **Settings → Git**:

- If the project is **not** connected to a Git repo, you are done — nothing to
  turn off. (Cleanest state for the Actions path.)
- If it **is** connected: either **Disconnect** the Git repository, **or** under
  *Ignored Build Step* set it to always skip:
  ```
  Settings → Git → Ignored Build Step → "Don't build anything" (command: exit 0)
  ```
  Disconnecting is the least ambiguous choice.

---

## 4. Set the `NEXT_PUBLIC_*` env vars in Vercel — Preview AND Production

**Why both.** These are `NEXT_PUBLIC_*` vars — Next.js **inlines them into the
client bundle at `vercel build`**. The workflow builds by pulling the Vercel
project's env: `--environment=preview` for staging, `--environment=production`
for main. They are pulled from **Vercel, not GitHub**. So each variable must
exist in **both** the *Preview* and *Production* environments in Vercel, or the
corresponding branch ships a bundle with blank values.

Vercel Dashboard → your project → **Settings → Environment Variables**. Add each
of these and tick **both** *Preview* and *Production* (Development optional):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID` | `CDYTGIGPCTYKTNYFVN2MUAKNMX5VO6RHP6HQQKWZOGXWKNKBQJWKJABU` |
| `NEXT_PUBLIC_STELLAR_REFLECTOR_CEX_CONTRACT_ID` | **fill in** (Reflector CEX/DEX oracle contract id) |
| `NEXT_PUBLIC_STELLAR_REFLECTOR_FX_CONTRACT_ID` | **fill in** (Reflector FX oracle contract id) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | **fill in** (from cloud.walletconnect.com) |
| `DATABASE_URL` | *optional* — Neon **pooled** connection string for the `/api/events` indexer route. **Server-only** (no `NEXT_PUBLIC_` prefix): it is read at request time by the route handler and is **not** inlined into the client bundle, unlike the vars above. Unset → the route returns 503 and the app stays RPC-only. |

> The two **Reflector** contract ids and the **WalletConnect** id are blank in
> `build.env.example`. If you leave the Reflector ids empty the app has **no
> price feed** (blank prices, broken quotes/LTV). Fill all three before you rely
> on the deploy.

None of these are secret — they are public chain identifiers, safe to put in the
Vercel dashboard.

**Also set the Production Branch.** Settings → Git (or Settings → Environments) →
set **Production Branch = `main`** so `--environment=production` maps to main.

---

## 5. Add the three GitHub repo secrets

On the GitHub repo you deploy from (`Whit3knight/StellarShield`): **Settings →
Secrets and variables → Actions → New repository secret**. Add:

| Secret | Source |
|---|---|
| `VERCEL_TOKEN` | the token from Step 2 (vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` |

CLI alternative (needs `gh` authenticated against that repo):

```bash
gh secret set VERCEL_TOKEN      --repo Whit3knight/StellarShield
gh secret set VERCEL_ORG_ID     --repo Whit3knight/StellarShield
gh secret set VERCEL_PROJECT_ID --repo Whit3knight/StellarShield
```

---

## 6. Create the deploy branches on origin

**Current state:** you are on local `main`; `origin` has only `development`.
Create both deploy branches on origin. Run exactly:

```bash
cd /Users/bri-anadi/Devarea/stellar-shield
git checkout main                       # you are already here; confirm
git push -u origin main                 # create origin/main (production)

git checkout -b staging main            # branch staging off main
git push -u origin staging              # create origin/staging (preview)
```

Now `origin` has `main`, `staging`, and the pre-existing `development`.

**Recommended branch strategy (lazy + clear):**

- Do day-to-day work on **`development`** (or feature branches → PR into it).
- Promote to **`staging`** to get a **Preview** deploy for smoke-testing.
- Promote/merge `staging` → **`main`** for **Production**.

```
development  →  staging (preview)  →  main (production)
```

> Only `main` and `staging` deploy. Pushing to `development` runs **no** deploy
> (and no CI at all — the workflow's `push`/`pull_request` triggers are limited
> to `main` and `staging`). That is expected.

---

## 7. Deploy

**Preview:**

```bash
git checkout staging
git push origin staging
```

Watch **GitHub → Actions → CI/CD**: `Quality` runs, then **Deploy Preview**.
Open the *Deploy preview* step log — the **preview URL** is printed by
`vercel deploy --prebuilt` at the end (also visible under *Deployments* in the
Vercel dashboard).

**Production:**

```bash
git checkout main
git merge --ff-only staging     # promote what you smoke-tested
git push origin main
```

Actions runs `Quality` → **Deploy Production**. Production goes live on your
project's production domain (`*.vercel.app` or your custom domain).

> `concurrency: cancel-in-progress` is on — pushing again to the same branch
> cancels the previous in-flight run. Normal; the latest push wins.

---

## 8. Verify

1. **Actions green** — Quality + the matching Deploy job both pass.
2. **Open the URL** (preview from Step 7, or production).
3. **Connect wallet** (Freighter / WalletConnect) on testnet.
4. **Prices render** — if they are blank, your Reflector ids are unset (Step 4).
5. **Run one borrow end-to-end.** This pulls `borrow.zkey` (~32 MB) from the
   Vercel CDN and proves in-browser. If it completes, the artifact serving +
   cross-origin-isolation headers are correct.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **Nothing deploys after a push** | Pushed to a branch that isn't `main`/`staging` (e.g. `development`), or those branches don't exist on origin | Redo Step 6; push to `staging`/`main`. This is the #1 gotcha. |
| **Deploy job "skipped"** in Actions | Same as above — the `if:` guard (`github.ref == refs/heads/staging|main`) didn't match | Push the correct branch. |
| **`quality` job fails** → deploy never runs | lint / typecheck / test / `check:artifacts` / build failed | Reproduce locally: `bun run lint && bun run typecheck && bun run test && bun run check:artifacts && bun run build`. Fix, repush. |
| **Blank prices / broken LTV in the deployed app** | `NEXT_PUBLIC_STELLAR_REFLECTOR_*` unset in Vercel for that environment | Set both Reflector ids in Vercel for **Preview and Production** (Step 4), then repush to rebuild — env is inlined at build, not runtime. |
| **Two deployments per push** | Vercel native Git auto-deploy still on | Step 3 — disconnect Git or set Ignored Build Step to skip. |
| **Preview works, production is blank (or vice-versa)** | Env vars set in only one Vercel environment | Add the vars to **both** Preview and Production (Step 4). |
| **`vercel` auth / "project not found" in Actions** | Missing/wrong `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`, or secrets on the wrong repo | Re-verify Step 5 values against `.vercel/project.json`; ensure secrets live on the repo you push to. |
| **Browser blocks the WASM prover / borrow fails to prove** | A cross-origin subresource broke `Cross-Origin-Embedder-Policy: require-corp` | Keep every subresource same-origin (no external CDN/analytics/image host). See `deploy/README.md`. |
| **`bun run build` fails on `next/font`** | `next/font` fetches Google Fonts at build; needs network | GitHub Actions has network, so this normally passes; only relevant for offline/self-host builds. |
| **`/api/events` returns 503 "indexer not configured"** | `DATABASE_URL` unset for that environment | Expected dark-launch behavior — the app falls back to RPC-only event scans. Set `DATABASE_URL` (Neon pooled string) in Vercel to enable the indexer. |

---

## What's optional (skip for a minimal testnet deploy)

- Custom domain — the `*.vercel.app` URL works fine.
- Vercel **Pro** — only when egress on the ZK artifacts outgrows Hobby's
  100 GB/mo (see `deploy/README.md` → *Plan / bandwidth*).
- The `development` → `staging` → `main` promotion flow — you *can* push straight
  to `main`; the staging preview just gives you a safety net.
