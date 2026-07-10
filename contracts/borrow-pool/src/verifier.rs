//! UltraHonk-over-BLS12-381 verifier scaffolding for the borrow-eligibility
//! circuit.
//!
//! Scheme: **UltraHonk**. Noir 1.0.0-beta.22 + Barretenberg 5.0.0-nightly
//! only export UltraHonk verification keys — no direct Groth16 export.
//! No mature UltraHonk Rust verifier crate targets Soroban BLS12-381 host
//! functions yet, so this module ships the *shape* + *VK pinning* and
//! leaves the pairing-check math for the next audit-gated round.
//!
//! The verifying key artefact was produced by:
//!
//!     cd contracts/circuits/borrow-eligibility
//!     nargo compile
//!     bb write_vk -b target/borrow_eligibility.json -o target/vk
//!
//! `vk.bin` is the raw VK bytes. `vk_hash.bin` is the 32-byte SHA-256-ish
//! digest bb produced; the contract pins that hash so any drift between
//! the circuit and the on-chain verifier is caught at deploy time.
//!
//! ponytail: real body pending
//!   - path A: port a minimal UltraHonk-over-BLS12-381 verifier to Rust
//!     using `env.crypto().bls12_381()` host fns; big audit item
//!   - path B: switch prover to Circom+snarkjs Groth16; 3-pairing verify
//!     is 50 Rust lines, but rewires the whole prover pipeline
//!   - path C: RISC Zero zkVM Groth16 wrapper; heavy prover, off-the-shelf
//!     Nethermind/SDF Soroban verifier
//! Decision gates on gas measurement + auditor availability.

use soroban_sdk::Env;

use crate::{BorrowIntent, BorrowProof};

/// Pinned UltraHonk verifying key bytes (produced by `bb write_vk`).
/// Any change to the circuit invalidates this — recompile, regenerate,
/// and re-embed via `include_bytes!` before redeploying.
pub const PINNED_VK: &[u8] = include_bytes!("vk.bin");

/// 32-byte digest of `PINNED_VK` as produced by `bb write_vk`. Contracts
/// can expose this via a view function so operators can verify their
/// off-chain circuit matches the on-chain expectation.
pub const PINNED_VK_HASH: &[u8; 32] = include_bytes!("vk_hash.bin");

/// Groth16-style structure of a would-be verifier. Signature preserved
/// so the pairing math can drop in without touching call sites.
pub fn verify_groth16(_env: &Env, intent: &BorrowIntent, proof: &BorrowProof) -> bool {
    // 1. Proof size sanity. UltraHonk proofs sit around ~10 kB; a
    //    real Groth16 swap would tighten this to 192 bytes.
    if proof.proof_bytes.len() < 1_024 {
        return false;
    }

    // 2. Amount/threshold sanity checks. Circuit binds these as public
    //    inputs, but a belt-and-braces check gives auditors a signal
    //    the contract knows what it should be verifying.
    if intent.health_factor_bps == 0 || intent.max_ltv_bps == 0 {
        return false;
    }
    if intent.borrow_amount as u128 > u64::MAX as u128 {
        return false;
    }
    if intent.collateral_amount as u128 > u64::MAX as u128 {
        return false;
    }

    // 3. Pairing check — real body pending, see module docs.
    //
    // Placeholder: reject every proof. Prevents accidentally deploying
    // a "verifier" that accepts anything before real math lands.
    false
}
