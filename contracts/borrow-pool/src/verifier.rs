//! Groth16 verifier scaffolding over BLS12-381 for the borrow-eligibility
//! circuit.
//!
//! The pairing equation is
//!
//!     e(A, B) = e(alpha_g1, beta_g2)
//!             * e(vk_x, gamma_g2)
//!             * e(C, delta_g2)
//!
//! where `vk_x = sum_i (vk_ic[i] * public_input[i])`.
//!
//! ponytail: the verifying key constants (alpha_g1, beta_g2, gamma_g2,
//! delta_g2, vk_ic) come from the Noir circuit build artifact
//! (`contracts/circuits/borrow-eligibility`). They land here once the
//! circuit is frozen and compiled — Phase 6. Until then, this module
//! exposes only the API shape and the non-crypto cross-checks so the
//! contract carries the full audit surface today.

use soroban_sdk::Env;

use crate::{BorrowIntent, BorrowProof};

/// Groth16 verification with all cross-checks required by the circuit
/// public inputs.
///
/// Returns `true` iff the proof is well-formed, binds to every field
/// on the `intent`, and the pairing equation holds against the pinned
/// verifying key.
///
/// Phase 2 stub: everything except the pairing check is wired. The
/// pairing math itself is inserted in Phase 6 after the circuit is
/// frozen and its verifying key is committed as a constant.
pub fn verify_groth16(_env: &Env, intent: &BorrowIntent, proof: &BorrowProof) -> bool {
    // 1. Proof size sanity: A (48 bytes G1 compressed) + B (96 bytes G2
    //    compressed) + C (48 bytes G1 compressed) = 192 bytes.
    if proof.proof_bytes.len() != 192 {
        return false;
    }

    // 2. Threshold sanity: proof-side threshold cannot be weaker than
    //    the intent's declared thresholds. Circuit already binds these
    //    as public inputs, but the check here is a belt-and-braces
    //    audit signal.
    if intent.health_factor_bps == 0 || intent.max_ltv_bps == 0 {
        return false;
    }

    // 3. Amount sanity: circuit uses u64; contract stores i128 and
    //    checks positivity in the caller. Reject sizes the circuit
    //    cannot express.
    if intent.borrow_amount as u128 > u64::MAX as u128 {
        return false;
    }
    if intent.collateral_amount as u128 > u64::MAX as u128 {
        return false;
    }

    // 4. Pairing check.
    //
    // ponytail: real body pending. Shape:
    //
    //     let bls = env.crypto().bls12_381();
    //     let public_inputs = pack_public_inputs(intent, proof);
    //     let vk_x = bls.g1_msm(&VK_IC, &public_inputs);
    //     let lhs = bls.pairing(A, B);
    //     let rhs = bls.pairing_check(&[
    //         (ALPHA_G1, BETA_G2),
    //         (vk_x,    GAMMA_G2),
    //         (C,       DELTA_G2),
    //     ]);
    //     lhs == rhs
    //
    // Placeholder: reject every proof. Prevents accidentally deploying
    // a "verifier" that accepts anything before real math lands.
    false
}
