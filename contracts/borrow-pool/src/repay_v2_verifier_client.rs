//! Thin cross-contract client for `repay-v2-verifier-helper` (R23 split
//! — see docs/REMEDIATION.md R23). The verifier's embedded VK bytes and
//! pairing-check logic live in that separate, stateless contract, not
//! here — same reasoning as `price_cap_client.rs`'s R17 split.

#![allow(dead_code)]

use soroban_sdk::{
    contractclient,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    Env, Vec,
};

#[contractclient(name = "RepayV2VerifierClient")]
pub trait RepayV2VerifierInterface {
    fn verify(
        env: Env,
        proof_a: G1Affine,
        proof_b: G2Affine,
        proof_c: G1Affine,
        pub_signals: Vec<Fr>,
    ) -> bool;
}
