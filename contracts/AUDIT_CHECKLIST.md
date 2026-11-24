# Audit Checklist

Pre-audit freeze artefacts for Stellar Shield. Stack: Circom 2.x circuits,
Groth16 over BLS12-381 (snarkjs), Soroban contract `contracts/borrow-pool`.
Two audit tracks: circuit soundness (ZK team) and contract logic (Soroban
team). Freeze both before engagement; post-freeze changes reset the audit
clock.

> Replaces the earlier Noir/Barretenberg/Pedersen checklist, which described
> a retired circuit (`borrow-eligibility`). Shipped circuits:
> `contracts/circuits/shielded-{deposit,deposit-quad,withdraw,borrow,repay,repay-v2,liquidate,liquidate-v2}/`.

## Known gaps to disclose at audit start

Verified on `development` (see `contracts/circuits/tests/liquidate.witness.test.ts`):

- [x] `oracle_price` is a public borrow signal cross-checked against Reflector (R20); LTV/HF are scale-correct (R21); the liquidate-v2 circuit accepts underwater and rejects healthy positions, strict at the boundary (R22). A real Groth16 proof verifies against the shipped zkey/VK, and forging the public price after proving fails.
- [ ] circomspect (`bun run check:circuits`) reports, and these are not yet triaged:
  - `liquidate` / `liquidate-v2`: `LessThan(200)` inputs `lhs`/`rhs` are not range-bounded in-circuit. Soundness rests on `current_price` being cross-checked by the contract and the other operands being bound by the borrow-time Poseidon commitments. Add `Num2Bits` bounds as defence in depth (needs new zkey, VK and redeploy).
  - `jubjub_pedersen.circom` `JubjubAdd`: unconstrained divisors `1 + d*tau`, `1 - d*tau`. Non-zero for on-curve points on a complete Edwards curve; confirm the argument and that every input point is on-curve.
- [ ] `current_price = 0` is satisfiable by the circuit (it reads as "underwater"); the contract's live-Reflector cross-check is the only guard. Pinned by a test so a change is deliberate.
- [ ] The TS `isUnderwater` floors a division; the circuit cross-multiplies exactly. They can disagree by one unit exactly at the boundary.
- [ ] Re-verify the claim vs liquidate nullifier namespaces on one loan (`LoanNullifierUsed`); not re-checked after the R-series changes.
- [ ] No Rust unit tests (blocked on soroban-sdk 23); fixtures + testnet e2e stand in.
- [ ] Single-contributor trusted setup (testnet only).

## Circuits (per circuit)

Frozen artefacts:
- [ ] `src/*.circom` pinned; `circom -p bls12381` version recorded
- [ ] `.wasm`, `.zkey`, `verification_key.json` SHA-256 in `features/shielded-pool/artifact-manifest.json` (`bun run check:artifacts`)
- [ ] Verifier bytes in `contracts/borrow-pool/src/vk/<circuit>/` regenerate from the same `verification_key.json`
- [ ] Reproducible build documented

Audit prompts:
- [ ] Under-constrained signals (run circomspect on every circuit)
- [ ] Every public signal is bound by a constraint; public-signal order matches the contract's index reads
- [ ] Range checks on every value cast to `u128`/`u32` in the contract (`fr_to_u128`, `fr_to_u32`)
- [ ] Comparator widths (`GreaterThan(200)` etc.) cover worst-case products without wrap
- [ ] Merkle path bits boolean-constrained; depth 20 matches `merkle.rs`
- [ ] Poseidon parameters identical across circom, `features/notes/poseidon.ts`, `poseidon.rs`
- [ ] `should-fail` witness tests: underwater/healthy/boundary, LTV above max, tampered openings

## Contract (`contracts/borrow-pool`)

Frozen artefacts:
- [ ] `cargo build --release --target wasm32v1-none` clean; WASM SHA-256 pinned
- [ ] Deployed contract id (canonical: see README) + deployer recorded

Audit prompts:
- [ ] `require_auth` on every state-changing entry; admin/upgrade authority
- [ ] Nullifier namespaces per tree/asset; replay guards for every spend path
- [ ] Claim / repay / liquidate mutual exclusion on one loan
- [ ] Oracle epoch bound: stale and future-dated rejected; zero price rejected
- [ ] Denomination caps and unit domain (raw stroops) on every `token::transfer`
- [ ] Interest accrual (`rate.rs`) rounding and index monotonicity
- [ ] Bounty payout cap; reentrancy across token contracts
- [ ] Storage TTL / eviction for nullifier sets and bonds
- [ ] Event emission after state write

## App-side (`features/shielded-pool`, `features/notes`)

- [ ] Artifacts fetched through the hash-pinned loader only
- [ ] Note secrets persisted only in the note store; never in events/memos in clear
- [ ] Prover public-signal ordering unit-tested per circuit

## Reference impls used

- [ ] circom / snarkjs versions pinned (`snarkjs` exact in `package.json`)
- [ ] Groth16 verifier code in `src/verifier.rs` provenance and version
- [ ] soroban-sdk version pinned (workspace)

## Post-audit gate

- [ ] Findings triaged: critical/high closed; medium/low with dispositions
- [ ] Re-audit round if any post-fix diff touches a circuit or verifier
- [ ] Contract redeployed with audit-final WASM; contract id updated everywhere
