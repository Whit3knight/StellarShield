# Stellar Shield

Zcash-style shielded lending pool on Stellar. Wallet + amount stay hidden.
Deposit into a per-asset commitment tree, borrow against 4 collateral notes
with a zk-proof-verified LTV check, withdraw the loan into a wallet, or
repay by burning a same-asset deposit note against the loan. Nullifiers
guard against double-spend; encrypted memos let a fresh browser rebuild the
user's note inventory from public events alone.

## Stack

- **Frontend**: Next.js 16 (App Router, Turbopack), TypeScript, Tailwind, Base UI + local COSS primitives.
- **Circuit**: Circom 2.2.3 with snarkjs Groth16 over BLS12-381.
- **Contract**: `soroban-sdk = 22.0.8`, verifier uses Protocol 22 BLS12-381 host fns.
- **Oracle**: Reflector Pulse (SEP-40 interface) — CEX/DEX + FX feeds via Soroban simulate.
- **Wallet**: Freighter (primary), WalletConnect scaffolding present.
- **Package manager**: **Bun**.

## Testnet contract

| Item | Value |
| --- | --- |
| Contract ID | `CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L` |
| Admin | `GCGLOK2DM2Y4NGESNJBTTOHEY7EB3MO35FV5YQSZIOWV6QW6ZNRXGPXK` |
| Network | Testnet (`Test SDF Network ; September 2015`) |
| Reflector CEX/DEX | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |
| Reflector FX | `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W` |

Registered markets: `USDC/XLM`, `XLM/USDC`, `EURC/USDC`, `USDC/EURC`, `EURC/XLM`, `XLM/EURC`.

## Setup

```bash
bun install
cp .env.example .env.local
# fill in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (optional). Testnet
# defaults for RPC, Horizon, contract IDs, and Reflector feeds ship in
# .env.example.

bun run dev       # http://localhost:3000
bun run lint
bun run typecheck
bun run test
bun run build     # needs network access (next/font pulls Google Fonts)
```

Freighter must be on testnet and funded (fund via
[friendbot](https://laboratory.stellar.org/#account-creator?network=testnet)
or `stellar keys fund default --network testnet`).

## Architecture

Shielded pool primitives:

- **Note** = `Poseidon(amount, asset_tag, sk, salt)` commitment on a per-asset incremental Merkle tree (depth 20, 3 deposit + 3 loan trees).
- **Nullifier** = `Poseidon(sk, index)` posted at spend time; replay-guarded on chain.
- **Shielded identity** = deterministic X25519 keypair derived from the wallet's Freighter signature. Encrypted memos (ChaCha20-Poly1305 over ECDH) attach the note's `(salt, amount, index)` to each deposit / borrow tx so the user can rebuild inventory by scanning public events.

Data flow, top → bottom:

```
Freighter connect → deriveShieldedIdentity(sig(seed_message))
       │
       ▼
Scanner (features/notes/scanner.ts) → getEvents(deposit|borrow|withdraw|repay)
       │                                    tryDecrypt each memo
       ▼
Note store (features/notes/note-store.ts) → useNotes()
       │
       ▼
Shielded drawer → deposit / borrow / withdraw / repay hooks
       │
       ▼
snarkjs Groth16 prover (public/circuits-circom/shielded/{deposit,borrow,withdraw,repay})
       │
       ▼
client.<op>_shielded(...).signAndSend via Freighter
       │
       ▼
contract emits ("<op>", asset, ...) → next scan pass reflects the state change
```

Key boundaries:

- `AdapterProvider` at `app/layout.tsx` picks Soroban vs mock adapter based on env.
- `features/markets/prices.ts` is the only place that talks to Reflector.
- `features/notes/scanner.ts` is the sole reader for building the user's note inventory; it consumes deposit + borrow (mints notes), withdraw + repay (marks nullifiers spent).
- `features/notes/note-store.ts` is the in-memory cache surfaced via `useNotes()`; scan replaces it wholesale each pass.
- `features/shielded-pool/` owns the hooks (`useDeposit`, `useBorrow`, `useWithdraw`, `useRepay`) plus the prover wrappers.
- `features/protocol/risk-params.ts` fetches contract-side risk params once per session and exposes `getRiskParams()` / `useRiskParams()`.

## Contract lifecycle (Rust)

Source: `contracts/borrow-pool/src/lib.rs`. Shielded pool API:

| Method | Auth | Notes |
| --- | --- | --- |
| `initialize_shielded(admin, reflector, rate, risk)` | one-shot | Sets admin + rate/risk params + reflector contract. |
| `set_reserve(asset, token_contract)` | admin | Registers the SEP-41 token used for a shielded asset. |
| `set_rate_params(params)` / `set_risk_params(params)` | admin | Runtime knobs. |
| `register_market(market)` | admin | Static market metadata (borrow/collateral pair). |
| `admin_transfer(new_admin)` / `upgrade(wasm_hash)` | admin | Same address, same state. |
| `deposit_shielded(from, asset, commitment, memo)` | account | Pulls fixed denomination, appends leaf, emits `("deposit", asset)` with `(index, root, leaf, memo)`. |
| `withdraw_shielded(to, asset, proof)` | account | Verifies Groth16, checks nullifier fresh, releases denomination. |
| `borrow_shielded(from, collateral_asset, borrow_asset, proof, memo)` | account | Consumes 4 collateral nullifiers, appends loan commitment, emits `("borrow", collateral_asset, borrow_asset)`. |
| `withdraw_loan_shielded(to, asset, proof)` | account | Loan-tree variant of withdraw; releases the borrower's minted loan amount. |
| `repay_shielded(from, asset, proof)` | account | Burns loan note + same-asset deposit note (deposit >= loan). |
| `list_markets()` / `rate_params()` / `risk_params()` / `deposit_root(asset)` / `loan_root(asset)` / `total_deposit(asset)` / `total_borrow(asset)` | view | |

Circuits at `contracts/circuits/shielded-{deposit,withdraw,borrow,repay}/` — Circom 2.1.9, BLS12-381, Poseidon commitments. Verifier bytes embedded in `contracts/borrow-pool/src/vk/<circuit>/*.bin`.

## Deploy workflow

The live contract at `CBJZP...4N7L` was deployed once and upgraded in place
for each iteration (Phase 1 receipt registry → Phase 2 shielded pool). Fresh
deploys follow the same pattern:

```bash
cd contracts
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/borrow_pool.wasm \
  --source deployer --network testnet
# → prints CONTRACT_ID

stellar contract invoke --id $CONTRACT_ID --source deployer --network testnet -- \
  initialize_shielded --admin <admin-address> \
    --reflector CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63 \
    --rate '{"base_apr_bps":200,"slope_apr_bps":1500,"reserve_factor_bps":1000,"seconds_per_year":31536000}' \
    --risk '{"hf_min_bps":12500,"liquidation_bonus_bps":500,"liquidation_threshold_bps":8500,"max_ltv_bps":6250}'

# Register the SEP-41 token per asset (contract must match the deposit intent):
stellar contract invoke --id $CONTRACT_ID --source deployer --network testnet -- \
  set_reserve --asset XLM --token_contract CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Same for each supported asset. Then register markets + bindings as before.
```

Subsequent changes: use the in-place upgrade path (same contract id, same
state) so the frontend contract id keeps working and live positions survive.

```bash
cd contracts
stellar contract build
stellar contract install \
  --wasm target/wasm32v1-none/release/borrow_pool.wasm \
  --source deployer --network testnet
# → prints WASM_HASH

stellar contract invoke \
  --id CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L \
  --source deployer --network testnet \
  -- upgrade --wasm_hash $WASM_HASH

# Regenerate bindings if the ABI changed; storage layout must stay
# backwards-compatible or migrate state before switching.
```

## End-to-end verification

1. `bun run dev` → connect Freighter (testnet). Scanner logs "N notes decrypted" once identity derivation completes.
2. Open the shielded drawer, click Deposit on an asset tile. Freighter signs `deposit_shielded`; on confirm the leaf lands and a new deposit note appears (`#index` badge).
3. Deposit at least 4 collateral notes of one asset; the `Borrow shielded` panel surfaces viable `collateral → borrow` pairs. Trigger a borrow — prover takes ~15-30s.
4. On the fresh loan note row, click **Claim** — receives the loan amount into Freighter via `withdraw_loan_shielded`.
5. Deposit a repay-source note in the loan's asset ≥ loan amount. **Repay** button appears on the loan note. Click → both nullifiers burn, loan note vanishes.
6. Any Withdraw button on a deposit note calls `withdraw_shielded` and receives the fixed denomination.
7. Refresh browser (or clear localStorage) → scanner rebuilds the same inventory from public events. No client-side backup needed.
8. `bun run lint && bun run typecheck && bun run test && bun run build` all green.

## Deferred

- **Interest accrual on repay**: v1 repay burns loan against deposit >= loan amount. The `borrow_index` snapshot / `repay_amount = loan × index` check will land in the v2 repay circuit alongside collateral recovery.
- **Collateral recovery on repay**: v1 leaves original collateral notes burned. v2 repay circuit will mint recovered collateral commitments back to the deposit tree.
- **Liquidation (self-liquidate)**: **shipped end-to-end**. Extended borrow circuit publishes 3 bond commitments; contract persists `LiquidationBond` keyed by the loan commitment; separate liquidate circuit (`shielded-liquidate`, 1476 non-linear constraints) proves a position is underwater and burns the loan nullifier via `liquidate_shielded`. Frontend `useLiquidate` hook + drawer "Liquidate" button + `LoanHealthBadge` render live health factors from cached Reflector prices. Dual-recipient memo encoding + admin-configured `liquidation_service_pk` slot are on-chain prerequisites for a permissionless off-chain service.
- **Liquidation (off-chain service worker)**: **Track A shipped end-to-end.** Borrow circuit gains a `loan_nullifier = Poseidon(sk, borrow_commitment)` public signal that lands in a `LoanNullifier(loan_commit)` sidecar at borrow-time. New `shielded-liquidate-v2` circuit (933 non-linear, pot12) drops sk from the witness — a service holding only the memo openings can prove. New `liquidate_shielded_v2` contract fn wraps the verifier with sidecar cross-checks. `useLiquidate` fetches the sidecar in parallel with the bond and branches: present → v2 path, absent → v1 fallback so grandfathered pre-A bonds stay borrower-self-liquidatable. Design ratified in `docs/liquidation-design.md` §Track A. FROST/threshold decryption (Track B) is now a pure decentralization layer on top — no additional circuit changes.
- **Other deferred**: bounty payout, `borrow_index` interest accrual on repay, integration tests on the full liquidation lifecycle against testnet.
- **Reflector on-chain commitment cross-check**: borrow circuit publishes a Poseidon commitment over the oracle price; the contract now enforces oracle freshness but not the commitment match. Waiting on a paired oracle attestation channel.
- **Rust unit tests**: soroban-sdk `testutils` feature triggers an upstream ed25519-dalek / rand_core conflict against soroban-env-host 22.1.x. Fixture cross-checks in `contracts/borrow-pool/tests/{poseidon,merkle}_fixtures.txt` cover the primitives until soroban-sdk 23 lands.

## Commands cheat sheet

```bash
# Dev
bun install
bun run dev
bun run lint
bun run typecheck
bun run test
bun run build

# Contract
cd contracts
stellar contract build
stellar contract install --wasm target/wasm32v1-none/release/borrow_pool.wasm --source deployer --network testnet
stellar contract invoke --id CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L --network testnet -- list_markets

# Bindings
stellar contract bindings typescript --contract-id CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L --network testnet --output-dir /tmp/bindings

# Liquidation watchlist (Track L)
# Enumerates every live LiquidationBond on the pool (skipping ones
# already burned by liquidate events) and prints them sorted oldest
# first. Read-only; does not touch memo openings.
bun run scan:underwater
LOOKBACK_LEDGERS=32000 bun run scan:underwater
```
