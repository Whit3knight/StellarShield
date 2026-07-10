# Audit Checklist

Pre-audit freeze artefacts for Stellar Shield contract + circuit. Two
audit tracks: circuit soundness (ZK team) and contract logic (Soroban
team). Freeze both before engagement — post-freeze changes reset the
audit clock.

## Circuit (`contracts/circuits/borrow-eligibility`)

Frozen artefacts:
- [ ] `SPEC.md` v1 (public inputs, private inputs, constraints, out-of-scope)
- [ ] `src/main.nr` — `nargo check` clean, `nargo test` all green
- [ ] Compiled artefact hash pinned (SHA-256 of `borrow-eligibility.compiled.json`)
- [ ] Verifying key hash pinned (`bb write_vk` `vk_hash.bin` — committed at `contracts/borrow-pool/src/vk_hash.bin`)
- [ ] Reproducible build script (`nargo compile` + `bb write_vk`) documented

Audit prompts:
- [ ] Constraint under-count — every claim in SPEC.md has ≥1 asserting constraint
- [ ] Public-input binding — every field mentioned in SPEC.md is `pub`
- [ ] Range checks — every `u64`/`u32` cast has a bit-width bound
- [ ] Overflow — `collateral_amount * oracle_price` bounded before division
- [ ] Pedersen commitment (skeleton hash choice) domain-separated if reused elsewhere. If swapped to Poseidon2 pre-audit, re-run this check.
- [ ] `should_fail` tests cover: underfunded, stale commitment, HF-below-min, LTV-above-max
- [ ] Fuzz targets: random valid witnesses → prove/verify roundtrip

## Contract (`contracts/borrow-pool`)

Frozen artefacts:
- [ ] `src/lib.rs` — `cargo check` + `cargo build --release --target wasm32v1-none` clean
- [ ] `src/verifier.rs` — pairing math filled with pinned VK constants
- [ ] WASM SHA-256 pinned + reproducible
- [ ] Deployed contract id + deployer signature recorded

Audit prompts:
- [ ] `require_auth` on caller; account bind matches proof's `account` public input
- [ ] Proof-id replay guard (persistent storage) — TTL and eviction plan
- [ ] Oracle epoch bound: reject stale + reject future-dated
- [ ] `oracle_price_commitment` cross-checked against on-chain oracle store
  (Reflector? permissioned? — decided separately)
- [ ] `hf_min_bps` + `max_ltv_bps` beat market's policy floor
- [ ] Positive-amount check on `borrow_amount` + `collateral_amount`
- [ ] Overflow safety across `i128` ↔ `u64` conversions in verifier bridge
- [ ] Event `borrow` emitted after successful state write (not before)
- [ ] No admin/upgrade path unless explicitly requested + documented

Not yet in scope (call these out at audit start so scope is explicit):
- Liquidity accounting
- Token transfers
- Interest accrual
- Repay / liquidate
- Admin/upgrade authority

## App-side (`features/proofs`, `features/protocol/soroban-adapter.ts`)

Not typically part of contract audit but flag:
- [ ] Prover WASM served only from same-origin, integrity-hashed
- [ ] Preload path fails silently (no user-facing telemetry leak)
- [ ] `contractProof` never persisted to `borrowSession` or localStorage
- [ ] `oracle_price` + `oracle_price_salt` never leave the prover process

## Reference impls used

Note every off-the-shelf verifier/prover crate used. Fork = full re-audit.

- [ ] Barretenberg version + git SHA
- [ ] Noir version + git SHA
- [ ] Nethermind / SDF Groth16 verifier crate version + git SHA
- [ ] soroban-sdk version pinned (workspace)

## Post-audit gate

- [ ] Findings triaged: critical/high closed; medium/low with dispositions
- [ ] Re-audit round scheduled if any post-fix diff touches circuit or verifier
- [ ] Contract redeployed with audit-final WASM; contract id updated
- [ ] `.env.local` for public app cutover to new contract id
