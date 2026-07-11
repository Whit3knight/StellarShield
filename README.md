# Stellar Shield

Privacy-preserving borrow dashboard on Stellar. Users prove eligibility for a
borrow position with a Groth16 proof over BLS12-381; the on-chain contract
verifies the proof, stores an anonymized receipt, and users close the
position via a signed `repay` call. Amounts stay hidden (private witness);
only market pair + timestamps + proof id land on chain.

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

Data flow, top → bottom:

```
Freighter → wallet balance polling (Horizon /accounts/{id} every 20s)
                                    │
                                    ▼
Market card → Reflector oracle (Soroban simulate lastprice / decimals)
              │
              ▼
Borrow drawer → Groth16 prover (snarkjs, artefacts in public/circuits-circom)
                │
                │ oracle_price + raw_collateral_balance fetched via
                │ Reflector + Horizon before witness generation
                ▼
              Soroban borrow (bindings signAndSend → Freighter)
                │
                ▼
              positions_by_account(account) → drawer receipts
              ("borrow",) event  ────► notification bell
                                  ────► activity drawer
                                  ────► wallet balance refresh

Repay:  drawer button → client.repay(account, proof_id) → signAndSend
                                              │
                                              ▼
                                     ("repay",) event → notify, refresh drawer + balance
```

Key boundaries:

- `AdapterProvider` at `app/layout.tsx` picks Soroban vs mock adapter based on env.
- `features/markets/prices.ts` is the only place that talks to Reflector.
- `features/borrow-flow/chain-positions.ts` is the only source for the drawer's on-chain position list.
- `features/borrow-flow/borrow-events.ts` is a tiny pub/sub bus fired on borrow/repay confirm; consumed by the drawer refresh, notification menu, and wallet balance refresh so a fresh confirmation propagates without polling.
- `features/borrow-flow/session-store.ts` persists only proofs (proof bytes are not on chain); positions + activities come from chain now.

## Contract lifecycle (Rust)

Source: `contracts/borrow-pool/src/lib.rs`. Public API:

| Method | Auth | Notes |
| --- | --- | --- |
| `initialize(admin)` | none (one-shot) | Sets `DataKey::Admin`; further attempts return `AlreadyInitialized`. |
| `register_market(market)` | admin | Appends `MarketMeta`; rejects duplicate key. |
| `admin_transfer(new_admin)` | admin | Relocates admin rights. |
| `upgrade(wasm_hash)` | admin | In-place `update_current_contract_wasm`; contract address + state preserved. |
| `borrow(intent, proof)` | account | Freshness + Groth16 verify + replay guard, stores `Position(account, proof_id)`, emits `borrow` event with receipt. |
| `repay(account, proof_id)` | account | Deletes position, drops from index, emits `repay` event. |
| `positions_by_account(account)` | none (view) | Enumerates receipts. |
| `position(account)` | none (view) | Latest receipt (back-compat). |
| `list_markets()` | none (view) | Registered pairs. |
| `admin()` | none (view) | Current admin. |

Storage keys: `Admin`, `Markets`, `Position(Address, BytesN<32>)`, `PositionsByAccount(Address)`, `ProofUsed(BytesN<32>)`.

## Deploy workflow

Fresh deploy (already done for `CBJZP...4N7L`):

```bash
cd contracts
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/borrow_pool.wasm \
  --source deployer --network testnet
# → prints CONTRACT_ID

stellar contract invoke --id $CONTRACT_ID --source deployer --network testnet \
  -- initialize --admin <admin-address>

for MARKET in "USDC_XLM|USDC|XLM" "XLM_USDC|XLM|USDC" \
              "EURC_USDC|EURC|USDC" "USDC_EURC|USDC|EURC" \
              "EURC_XLM|EURC|XLM" "XLM_EURC|XLM|EURC"; do
  IFS='|' read -r KEY B C <<< "$MARKET"
  stellar contract invoke --id $CONTRACT_ID --source deployer --network testnet \
    -- register_market --market "{\"key\":\"$KEY\",\"borrow_symbol\":\"$B\",\"collateral_symbol\":\"$C\"}"
done

stellar contract bindings typescript \
  --contract-id $CONTRACT_ID --network testnet --output-dir /tmp/bindings
cp /tmp/bindings/src/index.ts features/protocol/bindings/borrow-pool.ts
# add the pre-existing eslint-disable header line back at the top

# .env.local:
#   NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID=$CONTRACT_ID
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

1. `bun run dev` → connect Freighter (testnet).
2. Market card USD price reflects Reflector — sanity-check with
   `stellar contract invoke --id CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63 --network testnet -- lastprice --asset '{"Other":"XLM"}'`.
3. Open a borrow flow → verify → submit → Freighter signs.
4. Notification bell + activity drawer show the confirmed borrow.
5. Positions drawer shows an on-chain position (grouped by pair, chain badge = "Testnet").
6. Click Repay on a receipt → Freighter signs → success toast, drawer refetches, position gone.
7. `bun run lint && bun run typecheck && bun run test && bun run build` all green.

## Deferred

- **Reflector on-chain commitment check**: the circuit produces a Poseidon commitment; the contract currently trusts it. A real oracle cross-check needs Poseidon-on-BLS12-381 in Rust (no crate exists yet). See the top of `contracts/borrow-pool/src/lib.rs`.
- **Interest accrual + live APR / utilization / TVL**: the contract has no economic model. Displayed numbers are hardcoded.
- **Chart trend**: hardcoded 7-day series; needs an indexer (Mercury or self-hosted).
- **Nullifier scheme (Phase-2 privacy)**: swap the `account` field for a nullifier commitment so borrower identity is also hidden.
- **Rust unit tests**: soroban-sdk `testutils` feature triggers an upstream ed25519-dalek / rand_core conflict against soroban-env-host 22.1.x. Restore `src/test.rs` when soroban-sdk 23 lands.

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
```
