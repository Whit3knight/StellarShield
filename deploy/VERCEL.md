# Deploying the Web Tier — what the maintainer actually does

**Merging is the deploy.** There is nothing to run, no token to mint, no
command to type.

Vercel's GitHub App is connected to this repository and deploys on its own:
every branch push becomes a Preview, and `main` becomes Production. GitHub
Actions is **not** in the deploy path — `.github/workflows/ci-cd.yml` is a
quality gate only (lint, typecheck, tests, build, bundle guards).

> Earlier revisions of this runbook described a Vercel **CLI** deploy driven by
> Actions with `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`. That path
> failed on every run from 2026-07-10 onward (`vercel pull` could not
> authenticate) while the GitHub App deployed the same commits successfully.
> Those jobs were removed. Do not reinstate them — they would deploy each
> commit a second time.

## The flow

| Step | Who | What happens |
|---|---|---|
| push to `development` | contributor | CI runs · Vercel builds a **Preview** |
| merge `development` → `staging` | maintainer | CI runs · Vercel builds a **Preview** |
| merge `staging` → `main` | maintainer | CI runs · Vercel promotes to **Production** |

A contributor with read-only access cannot merge and cannot set repository
secrets. They open a pull request; the maintainer merges. That merge is the
entire deployment action.

## URLs

| Target | URL | Public? |
|---|---|---|
| Production | `https://www.stellarshield.xyz` | **yes** — verified HTTP 200 |
| Apex | `https://stellarshield.xyz` | 308 redirect to `www` |
| Branch preview | `https://stellar-shield-git-<branch>-whit3knights-projects.vercel.app` | **no** |

**Previews are gated.** They answer `302` to `vercel.com/sso-api`, so anyone
without a Vercel account on the team gets a login wall instead of the app. Fine
for internal review; useless for sending to a grant reviewer or an audience.
Anything outsiders must open has to go to Production, or Deployment Protection
has to be switched off for previews in **Project → Settings → Deployment
Protection**.

## Three things only the maintainer can fix

1. **Production is stale.** `main` is at `fdfc11d` (2026-07-16), well behind
   `development`. That build predates the raw-stroops unit domain and the
   per-asset nullifier namespaces, so the client it serves is wire-incompatible
   with the deployed contract. `https://www.stellarshield.xyz/api/events`
   returns **404** — the route does not exist in that build. Merging to `main`
   fixes it.

2. **Two Vercel projects are connected.** Every commit deploys twice, to
   `stellar-shield` and to `stellar-shield-fb6z`. Delete whichever one does not
   own the `stellarshield.xyz` domain.

3. **Environment variables live in the Vercel dashboard**, not in this repo.
   They must match `.env.example`; CI asserts the same contract ID appears in
   `.env.example`, the generated bindings, `e2e-testnet.yml`, the Goldsky
   pipeline, and `README.md`, but it cannot see Vercel's dashboard. After any
   contract redeploy, update **Project → Settings → Environment Variables** by
   hand and redeploy.

## Rollback

**Vercel → Deployments → pick a known-good build → Promote to Production.**
No rebuild, no git revert, effective in seconds. This is the reason the web
tier stays on Vercel rather than a VPS.

## Not used

`.github/workflows/deploy.yml` (rsync to a VPS behind Caddy) and the rest of
`deploy/` describe a self-hosted alternative that has never run. The keeper
tier in `deploy/README.md` is separate and unaffected — it is a hot-key worker,
not a web deploy.
