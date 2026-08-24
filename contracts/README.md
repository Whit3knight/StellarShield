# Stellar Shield Contracts

Soroban smart contracts backing the borrow flow. Independent Rust workspace —
not part of the Next.js app tree.

## Structure

- `borrow-pool/` — skeleton borrow pool. Verifies proof id has not been
  replayed, checks intent expiry, stores a receipt, emits `borrow` event.

## Prerequisites

```bash
rustup install stable
rustup target add wasm32v1-none
cargo install --locked stellar-cli
```

## Build

```bash
cd contracts
cargo build --release --target wasm32v1-none
```

WASM lands at
`contracts/target/wasm32v1-none/release/borrow_pool.wasm`.

## Test

Unit tests are pending. The published `soroban-env-host` `testutils`
path currently fails to compile against `ed25519-dalek 3.0` + `rand_core
0.9`. Add tests once upstream ships a fix.

Meanwhile `cargo check` and the WASM build verify the contract crate is
sound.

## Deploy (testnet)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/borrow_pool.wasm \
  --source <deployer-account> \
  --network testnet
```

Copy the returned contract id into
`NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID`, then set
`NEXT_PUBLIC_STELLAR_SHIELD_ADAPTER=soroban` in `.env.local`.

## Scope

Deposit / borrow / withdraw / repay / liquidate are all live, each behind a
Groth16 proof verified on-chain, over per-asset commitment trees. Interest
accrues on borrows via a linear-index curve (`rate.rs`); prices come from
Reflector (SEP-40). What's still missing: v1's repay circuit burns collateral
permanently (no collateral-recovery repay), there is no supply-side yield
payout (depositors earn nothing — `rate.rs::accrue_liquidity_index`'s output
is never read by any payout path), and liquidation's trigger inequality is
dimensionally broken so `liquidate_shielded` cannot currently be called (see
`docs/REMEDIATION.md`).
